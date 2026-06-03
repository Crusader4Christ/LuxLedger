import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type { JwtAuthConfig } from '@api/auth/jwt';
import { DEFAULT_JWT_ACCESS_TTL_SECONDS } from '@api/auth/policy';
import type { RateLimitConfig } from '@api/rate-limit/policy';
import { createServerCore, registerApplication } from '@api/server';
import {
  type AccountEntity,
  AccountId,
  AccountSide,
  type ApiKeyEntity,
  ApiKeyRole,
  EntryEntity,
  isUuidV7,
  LedgerId,
  Money,
  TransactionEntity,
  TransactionId,
} from '@lux/ledger';
import {
  type AccountPaginationQuery,
  type ApiKeyRepository,
  ApiKeyService,
  type BalanceAtQuery,
  type BalanceHistoryQuery,
  type BalanceSnapshotEvent,
  type CreateAccountInput,
  type CreateLedgerInput,
  type CreateReconRuleInput,
  type CreateTransactionInput,
  type CreateTransactionResult,
  EntryDirection,
  type HistoricalBalance,
  type IngestReconRecordsInput,
  InvariantViolationError,
  type Ledger,
  LedgerNotFoundError,
  type LedgerRepository,
  LedgerService,
  type LedgerTrialBalanceQuery,
  type PaginatedResult,
  type PaginationQuery,
  type ReconRule,
  type ReconRun,
  type ReconUpload,
  RepositoryError,
  type RunReconInput,
  type TransactionPaginationQuery,
  type TrialBalance,
} from '@lux/ledger/application';
import type {
  AccountResponse,
  AccountsPageResponse,
  AuthTokenResponse,
  CreateAccountRequest,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  EntriesPageResponse,
  EntryResponse,
  LedgerResponse,
  TransactionResponse,
  TransactionsPage,
  TrialBalanceResponse,
} from '@lux/ledger-http/contracts';
import type { FastifyServerOptions } from 'fastify';
import {
  assertAccountResponseShape,
  assertAccountsPageShape,
  assertOpenApiAccountsContractsSynced,
  createAccountRequestFactory,
} from './accounts-contract.fixtures';
import {
  assertAuthTokenResponseShape,
  assertCreateApiKeyResponseShape,
  assertOpenApiAuthAdminContractsSynced,
  createApiKeyRequestFactory,
} from './auth-admin-contract.fixtures';
import { assertEntriesPageShape, assertEntryResponseShape } from './entries-contract.fixtures';
import {
  assertLedgerResponseShape,
  assertLedgersListShape,
  assertTrialBalanceResponseShape,
} from './ledgers-contract.fixtures';
import {
  assertCreateTransactionResponseShape,
  assertOpenApiTransactionContractsSynced,
  assertTransactionResponseShape,
  assertTransactionsPageShape,
  createTransactionRequestFactory,
} from './transactions-contract.fixtures';

const makeUuidV7 = (seed: number): string => {
  const timestampHex = (Date.UTC(2026, 0, 1) + seed).toString(16).padStart(12, '0').slice(-12);
  const rand = (seed * 2654435761).toString(16).padStart(20, '0').slice(-20);
  return `${timestampHex.slice(0, 8)}-${timestampHex.slice(8, 12)}-7${rand.slice(0, 3)}-8${rand.slice(3, 6)}-${rand.slice(6, 18)}`;
};

class InMemoryLedgerRepository {
  private readonly ledgers = new Map<string, Ledger>();
  private readonly accounts = new Map<string, AccountEntity>();
  private readonly transactionsByReference = new Map<string, string>();
  private readonly holdsById = new Map<
    string,
    { tenantId: string; remainingAmountMinor: bigint; state: 'HELD' | 'APPLIED' | 'VOIDED' }
  >();

  public async createLedger(input: CreateLedgerInput): Promise<Ledger> {
    if (input.name === 'force-db-error') {
      throw new RepositoryError('forced repository error');
    }

    const now = new Date();
    const id = makeUuidV7(this.ledgers.size + 1);
    const ledger: Ledger = {
      id,
      tenantId: input.tenantId,
      name: input.name,
      createdAt: now,
      updatedAt: now,
    };

    this.ledgers.set(id, ledger);
    return ledger;
  }

  public async findLedgerByIdForTenant(tenantId: string, id: string): Promise<Ledger | null> {
    const ledger = this.ledgers.get(id);
    return ledger && ledger.tenantId === tenantId ? ledger : null;
  }

  public async findLedgersByTenant(tenantId: string): Promise<Ledger[]> {
    return [...this.ledgers.values()].filter((ledger) => ledger.tenantId === tenantId);
  }

  public async createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult> {
    const ledger = this.ledgers.get(input.ledgerId);
    if (!ledger || ledger.tenantId !== input.tenantId) {
      throw new LedgerNotFoundError(input.ledgerId);
    }

    if (input.entries.some((entry) => entry.amountMinor <= 0n)) {
      throw new InvariantViolationError('amount must be positive');
    }

    const key = `${input.tenantId}:${input.reference}`;
    const existing = this.transactionsByReference.get(key);
    if (existing) {
      return {
        transactionId: existing,
        created: false,
      };
    }

    const transactionId = makeUuidV7(this.transactionsByReference.size + 300);
    this.transactionsByReference.set(key, transactionId);

    return {
      transactionId,
      created: true,
    };
  }

  public async reverseTransaction(input: {
    tenantId: string;
    transactionId: string;
    reference: string;
    description?: string;
  }): Promise<{ transactionId: string; created: boolean }> {
    return { transactionId: `${input.transactionId}-reversal`, created: true };
  }

  public async correctTransaction(input: {
    tenantId: string;
    transactionId: string;
    reversalReference: string;
    correctedReference: string;
    description?: string;
    entries: Array<{
      accountId: string;
      direction: EntryDirection;
      amountMinor: bigint;
      currency: string;
    }>;
  }): Promise<{ reversalTransactionId: string; correctedTransactionId: string; created: boolean }> {
    return {
      reversalTransactionId: `${input.transactionId}-reversal`,
      correctedTransactionId: `${input.transactionId}-corrected`,
      created: true,
    };
  }

  public async createAccount(input: CreateAccountInput): Promise<AccountEntity> {
    const ledger = this.ledgers.get(input.ledgerId);
    if (!ledger || ledger.tenantId !== input.tenantId) {
      throw new LedgerNotFoundError(input.ledgerId);
    }

    const id = makeUuidV7(this.accounts.size + 101);
    const account: AccountEntity = {
      id,
      tenantId: input.tenantId,
      ledgerId: input.ledgerId,
      name: input.name,
      side: input.side,
      overdraftPolicy: 'ALLOW',
      currency: input.currency,
      balanceMinor: 0n,
      createdAt: new Date(),
    };

    this.accounts.set(id, account);
    return account;
  }

  public async createHold(input: {
    tenantId: string;
    ledgerId: string;
    reference: string;
    entries: Array<{ amountMinor: bigint }>;
  }): Promise<{
    holdId: string;
    created: boolean;
    state: 'HELD' | 'APPLIED' | 'VOIDED';
    remainingAmountMinor: bigint;
  }> {
    const holdId = makeUuidV7(this.holdsById.size + 600);
    const remainingAmountMinor =
      input.entries.reduce((sum, entry) => sum + entry.amountMinor, 0n) / 2n;
    this.holdsById.set(holdId, { tenantId: input.tenantId, remainingAmountMinor, state: 'HELD' });
    return { holdId, created: true, state: 'HELD', remainingAmountMinor };
  }

  public async commitHold(input: {
    tenantId: string;
    holdId: string;
    reference: string;
    amountMinor?: bigint;
  }): Promise<{
    holdId: string;
    state: 'HELD' | 'APPLIED';
    remainingAmountMinor: bigint;
    transactionId: string;
    created: boolean;
  }> {
    const hold = this.holdsById.get(input.holdId);
    if (!hold || hold.tenantId !== input.tenantId) {
      throw new InvariantViolationError('hold not found');
    }
    const key = `${input.tenantId}:${input.reference}`;
    const existingTransactionId = this.transactionsByReference.get(key);
    if (existingTransactionId) {
      return {
        holdId: input.holdId,
        state: hold.state === 'APPLIED' ? 'APPLIED' : 'HELD',
        remainingAmountMinor: hold.remainingAmountMinor,
        transactionId: existingTransactionId,
        created: false,
      };
    }
    if (hold.state !== 'HELD') {
      throw new InvariantViolationError('hold cannot be committed from current state');
    }
    const amount = input.amountMinor ?? hold.remainingAmountMinor;
    if (amount <= 0n || amount > hold.remainingAmountMinor) {
      throw new InvariantViolationError('invalid commit amount');
    }
    const remainingAmountMinor = hold.remainingAmountMinor - amount;
    hold.remainingAmountMinor = remainingAmountMinor;
    hold.state = remainingAmountMinor === 0n ? 'APPLIED' : 'HELD';
    const transactionId = makeUuidV7(this.transactionsByReference.size + 500);
    this.transactionsByReference.set(key, transactionId);
    return {
      holdId: input.holdId,
      state: hold.state as 'HELD' | 'APPLIED',
      remainingAmountMinor,
      transactionId,
      created: true,
    };
  }

  public async voidHold(input: {
    tenantId: string;
    holdId: string;
  }): Promise<{ holdId: string; state: 'VOIDED'; remainingAmountMinor: bigint; voided: boolean }> {
    const hold = this.holdsById.get(input.holdId);
    if (!hold || hold.tenantId !== input.tenantId) {
      throw new InvariantViolationError('hold not found');
    }
    hold.state = 'VOIDED';
    hold.remainingAmountMinor = 0n;
    return { holdId: input.holdId, state: 'VOIDED', remainingAmountMinor: 0n, voided: true };
  }
}

class InMemoryLedgerReadRepository {
  public async findAccountByIdForTenant(
    tenantId: string,
    accountId: string,
  ): Promise<AccountEntity | null> {
    if (tenantId !== VALID_TENANT_ID) {
      return null;
    }

    const accounts: AccountEntity[] = [
      {
        id: '00000000-0000-4000-8000-000000000101',
        tenantId: VALID_TENANT_ID,
        ledgerId: '00000000-0000-4000-8000-000000000001',
        name: 'Cash',
        side: EntryDirection.DEBIT,
        overdraftPolicy: 'ALLOW',
        currency: 'USD',
        balanceMinor: 100n,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: '00000000-0000-4000-8000-000000000102',
        tenantId: VALID_TENANT_ID,
        ledgerId: '00000000-0000-4000-8000-000000000001',
        name: 'Revenue',
        side: EntryDirection.CREDIT,
        overdraftPolicy: 'ALLOW',
        currency: 'USD',
        balanceMinor: 200n,
        createdAt: new Date('2026-01-01T00:00:01.000Z'),
      },
      {
        id: '00000000-0000-4000-8000-000000000103',
        tenantId: VALID_TENANT_ID,
        ledgerId: '00000000-0000-4000-8000-000000000002',
        name: 'Bank',
        side: EntryDirection.DEBIT,
        overdraftPolicy: 'ALLOW',
        currency: 'USD',
        balanceMinor: 300n,
        createdAt: new Date('2026-01-01T00:00:02.000Z'),
      },
    ];

    return accounts.find((account) => account.id === accountId) ?? null;
  }

  public async listAccounts(
    query: AccountPaginationQuery,
  ): Promise<PaginatedResult<AccountEntity>> {
    const account1: AccountEntity = {
      id: '00000000-0000-4000-8000-000000000101',
      tenantId: VALID_TENANT_ID,
      ledgerId: '00000000-0000-4000-8000-000000000001',
      name: 'Cash',
      side: EntryDirection.DEBIT,
      overdraftPolicy: 'ALLOW',
      currency: 'USD',
      balanceMinor: 100n,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const account2: AccountEntity = {
      id: '00000000-0000-4000-8000-000000000102',
      tenantId: VALID_TENANT_ID,
      ledgerId: '00000000-0000-4000-8000-000000000001',
      name: 'Revenue',
      side: EntryDirection.CREDIT,
      overdraftPolicy: 'ALLOW',
      currency: 'USD',
      balanceMinor: 200n,
      createdAt: new Date('2026-01-01T00:00:01.000Z'),
    };
    const account3: AccountEntity = {
      id: '00000000-0000-4000-8000-000000000103',
      tenantId: VALID_TENANT_ID,
      ledgerId: '00000000-0000-4000-8000-000000000002',
      name: 'Bank',
      side: EntryDirection.DEBIT,
      overdraftPolicy: 'ALLOW',
      currency: 'USD',
      balanceMinor: 300n,
      createdAt: new Date('2026-01-01T00:00:02.000Z'),
    };

    if (query.tenantId !== VALID_TENANT_ID) {
      return { data: [], nextCursor: null };
    }

    if (query.ledgerId === '00000000-0000-4000-8000-000000000001') {
      if (query.cursor === 'next-accounts') {
        return { data: [account2], nextCursor: null };
      }

      return { data: [account1], nextCursor: 'next-accounts' };
    }

    if (query.ledgerId === '00000000-0000-4000-8000-000000000002') {
      return { data: [account3], nextCursor: null };
    }

    if (query.ledgerId !== undefined) {
      return { data: [], nextCursor: null };
    }

    if (query.cursor === 'next-accounts') {
      return { data: [account2], nextCursor: null };
    }

    return { data: [account1], nextCursor: 'next-accounts' };
  }

  public async listTransactions(
    query: TransactionPaginationQuery,
  ): Promise<PaginatedResult<TransactionEntity>> {
    const transaction1 = new TransactionEntity({
      id: new TransactionId('00000000-0000-4000-8000-000000000201'),
      tenantId: VALID_TENANT_ID,
      ledgerId: new LedgerId('00000000-0000-4000-8000-000000000001'),
      reference: 'tx-ref-1',
      currency: 'USD',
      description: 'Payment settlement',
      createdAt: new Date('2026-01-01T00:01:00.000Z'),
      entries: [
        new EntryEntity({
          accountId: new AccountId('00000000-0000-4000-8000-000000000101'),
          direction: EntryDirection.DEBIT,
          money: Money.of(1n, 'USD'),
        }),
        new EntryEntity({
          accountId: new AccountId('00000000-0000-4000-8000-000000000102'),
          direction: EntryDirection.CREDIT,
          money: Money.of(1n, 'USD'),
        }),
      ],
    });
    const transaction2 = new TransactionEntity({
      id: new TransactionId('00000000-0000-4000-8000-000000000202'),
      tenantId: VALID_TENANT_ID,
      ledgerId: new LedgerId('00000000-0000-4000-8000-000000000001'),
      reference: 'tx-ref-2',
      currency: 'USD',
      description: null,
      createdAt: new Date('2026-01-01T00:01:01.000Z'),
      entries: [
        new EntryEntity({
          accountId: new AccountId('00000000-0000-4000-8000-000000000101'),
          direction: EntryDirection.DEBIT,
          money: Money.of(1n, 'USD'),
        }),
        new EntryEntity({
          accountId: new AccountId('00000000-0000-4000-8000-000000000102'),
          direction: EntryDirection.CREDIT,
          money: Money.of(1n, 'USD'),
        }),
      ],
    });

    if (query.tenantId !== VALID_TENANT_ID) {
      return { data: [], nextCursor: null };
    }

    if (query.ledgerId === '00000000-0000-4000-8000-000000000002') {
      return { data: [], nextCursor: null };
    }

    if (query.cursor === 'next-transactions') {
      return { data: [transaction2], nextCursor: null };
    }

    return { data: [transaction1], nextCursor: 'next-transactions' };
  }

  public async findTransactionByIdForTenant(
    tenantId: string,
    transactionId: string,
  ): Promise<TransactionEntity | null> {
    if (tenantId !== VALID_TENANT_ID) {
      return null;
    }

    if (transactionId !== '00000000-0000-4000-8000-000000000201') {
      return null;
    }

    return new TransactionEntity({
      id: new TransactionId('00000000-0000-4000-8000-000000000201'),
      tenantId: VALID_TENANT_ID,
      ledgerId: new LedgerId('00000000-0000-4000-8000-000000000001'),
      reference: 'tx-ref-1',
      currency: 'USD',
      description: 'Payment settlement',
      createdAt: new Date('2026-01-01T00:01:00.000Z'),
      entries: [
        new EntryEntity({
          accountId: new AccountId('00000000-0000-4000-8000-000000000101'),
          direction: EntryDirection.DEBIT,
          money: Money.of(1n, 'USD'),
        }),
        new EntryEntity({
          accountId: new AccountId('00000000-0000-4000-8000-000000000102'),
          direction: EntryDirection.CREDIT,
          money: Money.of(1n, 'USD'),
        }),
      ],
    });
  }

  public async listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryEntity>> {
    const entry1 = new EntryEntity({
      id: '00000000-0000-4000-8000-000000000301',
      transactionId: '00000000-0000-4000-8000-000000000201',
      accountId: new AccountId('00000000-0000-4000-8000-000000000101'),
      direction: EntryDirection.DEBIT,
      money: Money.of(123n, 'USD'),
      createdAt: new Date('2026-01-01T00:02:00.000Z'),
    });
    const entry2 = new EntryEntity({
      id: '00000000-0000-4000-8000-000000000302',
      transactionId: '00000000-0000-4000-8000-000000000201',
      accountId: new AccountId('00000000-0000-4000-8000-000000000102'),
      direction: EntryDirection.CREDIT,
      money: Money.of(123n, 'USD'),
      createdAt: new Date('2026-01-01T00:02:01.000Z'),
    });

    if (query.tenantId !== VALID_TENANT_ID) {
      return { data: [], nextCursor: null };
    }

    if (query.cursor === 'next-entries') {
      return { data: [entry2], nextCursor: null };
    }

    return { data: [entry1], nextCursor: 'next-entries' };
  }

  public async getLedgerTrialBalance(query: LedgerTrialBalanceQuery): Promise<TrialBalance> {
    if (query.tenantId !== VALID_TENANT_ID || query.ledgerId === UNKNOWN_LEDGER_ID) {
      throw new LedgerNotFoundError(query.ledgerId);
    }

    return {
      ledgerId: query.ledgerId,
      accounts: [
        {
          accountId: '00000000-0000-4000-8000-000000000101',
          code: '1000',
          name: 'Cash',
          normalBalance: EntryDirection.DEBIT,
          balanceMinor: 100n,
          isContra: false,
        },
        {
          accountId: '00000000-0000-4000-8000-000000000102',
          code: '4000',
          name: 'Revenue',
          normalBalance: EntryDirection.CREDIT,
          balanceMinor: 100n,
          isContra: false,
        },
      ],
      totalDebitsMinor: 100n,
      totalCreditsMinor: 100n,
    };
  }

  public async getBalanceAt(query: BalanceAtQuery): Promise<HistoricalBalance> {
    return {
      tenantId: query.tenantId,
      accountId: query.accountId,
      at: query.at,
      postedMinor: 100n,
      inflightDebitMinor: 10n,
      inflightCreditMinor: 5n,
      availableMinor: 95n,
    };
  }

  public async listBalanceHistory(
    query: BalanceHistoryQuery,
  ): Promise<PaginatedResult<BalanceSnapshotEvent>> {
    if (query.tenantId !== VALID_TENANT_ID) {
      return { data: [], nextCursor: null };
    }

    const all: BalanceSnapshotEvent[] = [
      {
        id: makeUuidV7(7001),
        tenantId: VALID_TENANT_ID,
        ledgerId: TEST_MAIN_LEDGER_ID,
        accountId: TEST_DEBIT_ACCOUNT_ID,
        eventType: 'HOLD_CREATED',
        sourceId: makeUuidV7(7101),
        postedMinor: 0n,
        inflightDebitMinor: 50n,
        inflightCreditMinor: 0n,
        effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: makeUuidV7(7002),
        tenantId: VALID_TENANT_ID,
        ledgerId: TEST_MAIN_LEDGER_ID,
        accountId: TEST_DEBIT_ACCOUNT_ID,
        eventType: 'HOLD_COMMITTED',
        sourceId: makeUuidV7(7102),
        postedMinor: -50n,
        inflightDebitMinor: 0n,
        inflightCreditMinor: 0n,
        effectiveAt: new Date('2026-01-01T00:05:00.000Z'),
        createdAt: new Date('2026-01-01T00:05:00.000Z'),
      },
      {
        id: makeUuidV7(7003),
        tenantId: VALID_TENANT_ID,
        ledgerId: TEST_MAIN_LEDGER_ID,
        accountId: TEST_DEBIT_ACCOUNT_ID,
        eventType: 'TX_APPLIED',
        sourceId: makeUuidV7(7103),
        postedMinor: -100n,
        inflightDebitMinor: 0n,
        inflightCreditMinor: 0n,
        effectiveAt: new Date('2026-01-01T00:10:00.000Z'),
        createdAt: new Date('2026-01-01T00:10:00.000Z'),
      },
    ];

    const inRange = all.filter(
      (item) =>
        item.effectiveAt.getTime() >= query.from.getTime() &&
        item.effectiveAt.getTime() <= query.to.getTime(),
    );
    if (query.cursor === undefined) {
      return {
        data: inRange.slice(0, query.limit),
        nextCursor: inRange.length > query.limit ? 'hist-cursor-1' : null,
      };
    }
    if (query.cursor === 'hist-cursor-1') {
      return {
        data: inRange.slice(query.limit, query.limit * 2),
        nextCursor: inRange.length > query.limit * 2 ? 'hist-cursor-2' : null,
      };
    }
    return { data: [], nextCursor: null };
  }
}

class InMemoryApiKeyRepository implements ApiKeyRepository {
  private readonly keys = new Map<string, ApiKeyEntity>();

  public constructor() {
    const now = new Date('2026-01-01T00:00:00.000Z');
    this.seed({
      id: '00000000-0000-4000-8000-000000000901',
      tenantId: VALID_TENANT_ID,
      name: 'Admin key',
      role: ApiKeyRole.ADMIN,
      createdAt: now,
      revokedAt: null,
      keyHash: hashApiKey(VALID_ADMIN_API_KEY),
    });
    this.seed({
      id: '00000000-0000-4000-8000-000000000902',
      tenantId: VALID_TENANT_ID,
      name: 'Service key',
      role: ApiKeyRole.SERVICE,
      createdAt: now,
      revokedAt: null,
      keyHash: hashApiKey(VALID_SERVICE_API_KEY),
    });
    this.seed({
      id: '00000000-0000-4000-8000-000000000903',
      tenantId: '22222222-2222-4222-8222-222222222222',
      name: 'Other tenant admin',
      role: ApiKeyRole.ADMIN,
      createdAt: now,
      revokedAt: null,
      keyHash: hashApiKey(OTHER_TENANT_ADMIN_API_KEY),
    });
  }

  public async findActiveApiKeyByHash(keyHash: string): Promise<ApiKeyEntity | null> {
    for (const key of this.keys.values()) {
      if (key.keyHash === keyHash && key.revokedAt === null) {
        return key;
      }
    }
    return null;
  }

  public async findApiKeyById(apiKeyId: string): Promise<ApiKeyEntity | null> {
    return this.keys.get(apiKeyId) ?? null;
  }

  public async countApiKeys(): Promise<number> {
    return this.keys.size;
  }

  public async createTenant(input: {
    name: string;
  }): Promise<{ id: string; name: string; createdAt: Date }> {
    return {
      id: VALID_TENANT_ID,
      name: input.name,
      createdAt: new Date(),
    };
  }

  public async createApiKey(input: {
    tenantId: string;
    name: string;
    role: ApiKeyRole;
    keyHash: string;
  }): Promise<ApiKeyEntity> {
    const createdAt = new Date();
    const id = makeUuidV7(this.keys.size + 904);
    const created: ApiKeyEntity = {
      id,
      tenantId: input.tenantId,
      name: input.name,
      role: input.role,
      createdAt,
      revokedAt: null,
      keyHash: input.keyHash,
    };
    this.seed(created);
    return created;
  }

  public async listApiKeys(tenantId: string): Promise<ApiKeyEntity[]> {
    return [...this.keys.values()].filter((key) => key.tenantId === tenantId);
  }

  public async revokeApiKey(tenantId: string, apiKeyId: string): Promise<boolean> {
    const key = this.keys.get(apiKeyId);
    if (!key || key.tenantId !== tenantId || key.revokedAt !== null) {
      return false;
    }

    this.keys.set(apiKeyId, {
      ...key,
      revokedAt: new Date(),
    });
    return true;
  }

  private seed(key: ApiKeyEntity): void {
    this.keys.set(key.id, key);
  }
}

interface ReadRepositoryPort {
  findAccountByIdForTenant(tenantId: string, accountId: string): Promise<AccountEntity | null>;
  findTransactionByIdForTenant(
    tenantId: string,
    transactionId: string,
  ): Promise<TransactionEntity | null>;
  listAccounts(query: AccountPaginationQuery): Promise<PaginatedResult<AccountEntity>>;
  listTransactions(query: TransactionPaginationQuery): Promise<PaginatedResult<TransactionEntity>>;
  listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryEntity>>;
  getLedgerTrialBalance(query: LedgerTrialBalanceQuery): Promise<TrialBalance>;
  getBalanceAt(query: BalanceAtQuery): Promise<HistoricalBalance>;
  listBalanceHistory(query: BalanceHistoryQuery): Promise<PaginatedResult<BalanceSnapshotEvent>>;
}

const createServer = (
  readinessCheck: () => Promise<void> = async () => {},
  readRepository: ReadRepositoryPort = new InMemoryLedgerReadRepository(),
  jwtAuth: JwtAuthConfig = createJwtAuthConfig(),
  rateLimit: RateLimitConfig = createRateLimitConfig(),
  logger: FastifyServerOptions['logger'] = false,
) => {
  const writeRepository = new InMemoryLedgerRepository();
  const repository: LedgerRepository = {
    createLedger: writeRepository.createLedger.bind(writeRepository),
    findLedgerByIdForTenant: writeRepository.findLedgerByIdForTenant.bind(writeRepository),
    findLedgersByTenant: writeRepository.findLedgersByTenant.bind(writeRepository),
    createAccount: writeRepository.createAccount.bind(writeRepository),
    findAccountByIdForTenant: readRepository.findAccountByIdForTenant.bind(readRepository),
    findTransactionByIdForTenant: readRepository.findTransactionByIdForTenant.bind(readRepository),
    createTransaction: writeRepository.createTransaction.bind(writeRepository),
    reverseTransaction: writeRepository.reverseTransaction.bind(writeRepository),
    correctTransaction: writeRepository.correctTransaction.bind(writeRepository),
    createHold: writeRepository.createHold.bind(writeRepository),
    commitHold: writeRepository.commitHold.bind(writeRepository),
    voidHold: writeRepository.voidHold.bind(writeRepository),
    listAccounts: readRepository.listAccounts.bind(readRepository),
    listTransactions: readRepository.listTransactions.bind(readRepository),
    listEntries: readRepository.listEntries.bind(readRepository),
    getLedgerTrialBalance: readRepository.getLedgerTrialBalance.bind(readRepository),
    getBalanceAt: readRepository.getBalanceAt.bind(readRepository),
    listBalanceHistory: readRepository.listBalanceHistory.bind(readRepository),
    ingestExternalRecords: async (input: IngestReconRecordsInput): Promise<ReconUpload> => ({
      id: makeUuidV7(910),
      tenantId: input.tenantId,
      source: input.source,
      recordCount: input.records.length,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }),
    createReconciliationMatchingRule: async (input: CreateReconRuleInput): Promise<ReconRule> => ({
      id: makeUuidV7(911),
      tenantId: input.tenantId,
      name: input.name,
      description: input.description ?? null,
      criteria: input.criteria,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }),
    listReconciliationMatchingRules: async (): Promise<ReconRule[]> => [],
    getReconciliationMatchingRule: async (): Promise<ReconRule | null> => null,
    runReconciliation: async (input: RunReconInput): Promise<ReconRun> => {
      const now = new Date('2026-01-01T00:00:00.000Z');
      return {
        id: makeUuidV7(912),
        tenantId: input.tenantId,
        ledgerId: input.ledgerId,
        uploadId: input.uploadId,
        strategy: input.strategy,
        status: 'completed',
        dryRun: input.dryRun ?? false,
        matchedCount: 0,
        unmatchedExternalCount: 0,
        unmatchedInternalCount: 0,
        mismatchedCount: 0,
        conflictCount: 0,
        startedAt: now,
        completedAt: now,
        results: [],
      };
    },
    getReconciliationRun: async (): Promise<ReconRun | null> => null,
  };
  const apiKeyRepository = new InMemoryApiKeyRepository();
  const apiKeyService = new ApiKeyService(apiKeyRepository);
  const ledgerService = new LedgerService(repository);

  const server = createServerCore({
    readinessCheck,
    logger,
  });

  registerApplication(server, {
    apiKeyService,
    ledgerService,
    jwtAuth,
    rateLimit,
  });

  return server;
};

const parsePayload = <T>(body: string): T => JSON.parse(body) as T;
const hashApiKey = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');
const VALID_TENANT_ID = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_LEDGER_ID = '00000000-0000-4000-8000-999999999999';
const VALID_ADMIN_API_KEY = 'llk_admin_test_key';
const VALID_SERVICE_API_KEY = 'llk_service_test_key';
const OTHER_TENANT_ADMIN_API_KEY = 'llk_admin_other_tenant';
const INVALID_API_KEY = 'llk_invalid';
const JWT_SIGNING_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY';
const PREVIOUS_JWT_SIGNING_KEY = 'YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODk';
const JWT_ISSUER = 'luxledger-api-test';
const JWT_TTL_SECONDS = DEFAULT_JWT_ACCESS_TTL_SECONDS;
const JWT_CLOCK_SKEW_SECONDS = 5;
const TEST_MAIN_LEDGER_ID = '00000000-0000-4000-8000-000000000001';
const TEST_DEBIT_ACCOUNT_ID = '00000000-0000-4000-8000-000000000101';
const TEST_CREDIT_ACCOUNT_ID = '00000000-0000-4000-8000-000000000102';

const createJwtAuthConfig = (overrides: Partial<JwtAuthConfig> = {}): JwtAuthConfig => ({
  signingKey: JWT_SIGNING_KEY,
  previousSigningKeys: [],
  issuer: JWT_ISSUER,
  accessTokenTtlSeconds: JWT_TTL_SECONDS,
  clockSkewSeconds: JWT_CLOCK_SKEW_SECONDS,
  ...overrides,
});

const createRateLimitConfig = (overrides: Partial<RateLimitConfig> = {}): RateLimitConfig => ({
  authToken: {
    maxRequests: 20,
    windowSeconds: 60,
    ...overrides.authToken,
  },
  write: {
    maxRequests: 120,
    windowSeconds: 60,
    ...overrides.write,
  },
});

const issueToken = async (
  server: ReturnType<typeof createServer>,
  apiKey: string,
): Promise<string> => {
  const response = await server.inject({
    method: 'POST',
    url: '/v1/auth/token',
    headers: {
      'x-api-key': apiKey,
    },
  });

  expect(response.statusCode).toBe(200);
  const payload = parsePayload<AuthTokenResponse>(response.body);
  assertAuthTokenResponseShape(payload);
  expect(payload.expires_in).toBe(JWT_TTL_SECONDS);
  return payload.access_token;
};

const authHeaders = async (
  server: ReturnType<typeof createServer>,
  apiKey = VALID_ADMIN_API_KEY,
): Promise<{ authorization: string }> => ({
  authorization: `Bearer ${await issueToken(server, apiKey)}`,
});

const parseMetricValue = (
  body: string,
  metricName: string,
  labels: Record<string, string>,
): string => {
  const labelsText = Object.entries(labels)
    .map(([name, value]) => `${name}="${value}"`)
    .join(',');
  const expression = new RegExp(`^${metricName}\\{${labelsText}\\} (.+)$`, 'm');
  const match = body.match(expression);

  if (!match) {
    throw new Error(`Metric ${metricName}{${labelsText}} not found`);
  }

  return match[1];
};

const parseJsonLogs = (lines: string[]): Record<string, unknown>[] =>
  lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe('server', () => {
  it('returns health response', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    const payload = JSON.parse(response.body) as { ok: boolean };

    expect(response.statusCode).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(response.headers['x-request-id']).toBeString();

    await server.close();
  });

  it('uses incoming x-request-id when provided', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'x-request-id': 'req-test-123',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('req-test-123');

    await server.close();
  });

  it('returns ready response when readiness check succeeds', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(response.statusCode).toBe(200);
    expect(parsePayload<{ ok: boolean }>(response.body)).toEqual({ ok: true });

    await server.close();
  });

  it('serves openapi specification file', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/openapi.yaml',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/yaml');
    expect(response.body).toContain('openapi: 3.1.0');
    assertOpenApiTransactionContractsSynced(response.body);
    assertOpenApiAuthAdminContractsSynced(response.body);
    assertOpenApiAccountsContractsSynced(response.body);

    await server.close();
  });

  it('serves swagger ui page', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/docs',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('SwaggerUIBundle');
    expect(response.body).toContain("url: '/openapi.yaml'");

    await server.close();
  });

  it('GET /metrics exposes request, latency, auth and token issuance failure metrics', async () => {
    const server = createServer();

    const healthResponse = await server.inject({
      method: 'GET',
      url: '/health',
    });
    expect(healthResponse.statusCode).toBe(200);

    const tokenFailure = await server.inject({
      method: 'POST',
      url: '/v1/auth/token',
    });
    expect(tokenFailure.statusCode).toBe(401);

    const authFailure = await server.inject({
      method: 'GET',
      url: '/v1/ledgers',
    });
    expect(authFailure.statusCode).toBe(401);

    const response = await server.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(
      parseMetricValue(response.body, 'luxledger_http_requests_total', {
        route: '/health',
        status: '200',
      }),
    ).toBe('1');
    expect(
      parseMetricValue(response.body, 'luxledger_http_request_duration_seconds_count', {
        route: '/health',
        status: '200',
      }),
    ).toBe('1');
    expect(
      parseMetricValue(response.body, 'luxledger_auth_failures_total', {
        route: '/v1/auth/token',
        status: '401',
      }),
    ).toBe('1');
    expect(
      parseMetricValue(response.body, 'luxledger_auth_failures_total', {
        route: '/v1/ledgers',
        status: '401',
      }),
    ).toBe('1');
    expect(
      parseMetricValue(response.body, 'luxledger_token_issuance_failures_total', {
        status: '401',
      }),
    ).toBe('1');

    await server.close();
  });

  it('request logs include required context fields and do not leak API keys or bearer tokens', async () => {
    const logLines: string[] = [];
    const server = createServer(
      async () => {},
      new InMemoryLedgerReadRepository(),
      createJwtAuthConfig(),
      createRateLimitConfig(),
      {
        level: 'info',
        stream: {
          write: (chunk: string) => {
            logLines.push(chunk);
          },
        },
      },
    );

    const issuedToken = await issueToken(server, VALID_ADMIN_API_KEY);
    const ledgersResponse = await server.inject({
      method: 'GET',
      url: '/v1/ledgers',
      headers: {
        authorization: `Bearer ${issuedToken}`,
      },
    });
    expect(ledgersResponse.statusCode).toBe(200);

    const parsedLogs = parseJsonLogs(logLines);
    const completedLog = parsedLogs.find(
      (entry) =>
        entry.msg === 'Request completed' &&
        entry.route === '/v1/ledgers' &&
        entry.statusCode === 200,
    );

    expect(completedLog).toBeDefined();
    expect(completedLog?.requestId).toBeString();
    expect(completedLog?.tenantId).toBe(VALID_TENANT_ID);
    expect(completedLog?.apiKeyId).toBeString();
    expect(completedLog?.route).toBe('/v1/ledgers');

    const fullLogText = logLines.join('\n');
    expect(fullLogText.includes(VALID_ADMIN_API_KEY)).toBeFalse();
    expect(fullLogText.includes(issuedToken)).toBeFalse();

    await server.close();
  });

  it('returns 503 when readiness check fails', async () => {
    const server = createServer(async () => {
      throw new Error('db unavailable');
    });

    const response = await server.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(response.statusCode).toBe(503);
    expect(parsePayload<{ error: string; message: string }>(response.body)).toEqual({
      error: 'NOT_READY',
      message: 'Service not ready',
    });

    await server.close();
  });

  it('POST /v1/ledgers validates input', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: await authHeaders(server),
      payload: { name: '' },
    });

    expect(response.statusCode).toBe(400);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('INVALID_INPUT');

    await server.close();
  });

  it('GET /v1/ledgers/:id maps LedgerNotFoundError to 404', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: `/v1/ledgers/${UNKNOWN_LEDGER_ID}`,
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(404);
    expect(parsePayload<{ error: string; message: string }>(response.body)).toEqual({
      error: 'LEDGER_NOT_FOUND',
      message: `Ledger not found: ${UNKNOWN_LEDGER_ID}`,
    });

    await server.close();
  });

  it('POST /v1/auth/token returns access token for valid api key', async () => {
    const server = createServer();

    const token = await issueToken(server, VALID_ADMIN_API_KEY);

    expect(token.length > 0).toBeTrue();

    await server.close();
  });

  it('POST /v1/auth/token requires x-api-key header', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/auth/token',
    });

    expect(response.statusCode).toBe(401);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('UNAUTHORIZED');

    await server.close();
  });

  it('POST /v1/auth/token allows requests up to configured limit', async () => {
    const server = createServer(
      async () => {},
      new InMemoryLedgerReadRepository(),
      createJwtAuthConfig(),
      createRateLimitConfig({
        authToken: {
          maxRequests: 2,
          windowSeconds: 60,
        },
      }),
    );

    const first = await server.inject({
      method: 'POST',
      url: '/v1/auth/token',
      headers: {
        'x-api-key': VALID_ADMIN_API_KEY,
      },
    });
    const second = await server.inject({
      method: 'POST',
      url: '/v1/auth/token',
      headers: {
        'x-api-key': VALID_ADMIN_API_KEY,
      },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    await server.close();
  });

  it('POST /v1/auth/token rejects requests above configured limit with deterministic payload', async () => {
    const server = createServer(
      async () => {},
      new InMemoryLedgerReadRepository(),
      createJwtAuthConfig(),
      createRateLimitConfig({
        authToken: {
          maxRequests: 1,
          windowSeconds: 120,
        },
      }),
    );

    const first = await server.inject({
      method: 'POST',
      url: '/v1/auth/token',
      headers: {
        'x-api-key': VALID_ADMIN_API_KEY,
      },
    });
    const second = await server.inject({
      method: 'POST',
      url: '/v1/auth/token',
      headers: {
        'x-api-key': VALID_ADMIN_API_KEY,
      },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(
      parsePayload<{ error: string; message: string; retry_after_seconds: number }>(second.body),
    ).toEqual({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Rate limit exceeded',
      retry_after_seconds: 120,
    });
    expect(second.headers['retry-after']).toBe('120');

    await server.close();
  });

  it('GET /v1/ledgers requires bearer token header', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ledgers',
    });

    expect(response.statusCode).toBe(401);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('UNAUTHORIZED');

    await server.close();
  });

  it('GET /v1/ledgers rejects invalid bearer token', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ledgers',
      headers: {
        authorization: `Bearer ${INVALID_API_KEY}`,
      },
    });

    expect(response.statusCode).toBe(401);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('UNAUTHORIZED');

    await server.close();
  });

  it('GET /v1/ledgers accepts token signed with previous verification key during rotation grace window', async () => {
    const oldServer = createServer(
      async () => {},
      new InMemoryLedgerReadRepository(),
      createJwtAuthConfig({
        signingKey: PREVIOUS_JWT_SIGNING_KEY,
        previousSigningKeys: [],
      }),
    );
    const token = await issueToken(oldServer, VALID_ADMIN_API_KEY);

    await oldServer.close();

    const rotatedServer = createServer(
      async () => {},
      new InMemoryLedgerReadRepository(),
      createJwtAuthConfig({
        previousSigningKeys: [PREVIOUS_JWT_SIGNING_KEY],
      }),
    );

    const response = await rotatedServer.inject({
      method: 'GET',
      url: '/v1/ledgers',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);

    await rotatedServer.close();
  });

  it('GET /v1/ledgers rejects token after previous verification key is removed', async () => {
    const oldServer = createServer(
      async () => {},
      new InMemoryLedgerReadRepository(),
      createJwtAuthConfig({
        signingKey: PREVIOUS_JWT_SIGNING_KEY,
        previousSigningKeys: [],
      }),
    );
    const token = await issueToken(oldServer, VALID_ADMIN_API_KEY);

    await oldServer.close();

    const rotatedServer = createServer();

    const response = await rotatedServer.inject({
      method: 'GET',
      url: '/v1/ledgers',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(parsePayload<{ error: string; message: string }>(response.body).error).toBe(
      'UNAUTHORIZED',
    );

    await rotatedServer.close();
  });

  it('POST /v1/ledgers maps repository failures to 500', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: await authHeaders(server),
      payload: {
        name: 'force-db-error',
      },
    });

    expect(response.statusCode).toBe(500);
    expect(parsePayload<{ error: string; message: string }>(response.body)).toEqual({
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });

    await server.close();
  });

  it('POST /v1/ledgers creates ledger through LedgerService', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: await authHeaders(server),
      payload: {
        name: 'Main ledger',
      },
    });

    expect(response.statusCode).toBe(201);

    const payload = parsePayload<Ledger>(response.body);

    expect(payload.tenantId).toBe(VALID_TENANT_ID);
    expect(payload.name).toBe('Main ledger');

    await server.close();
  });

  it('POST /v1/* write endpoints reject requests above configured baseline limit', async () => {
    const server = createServer(
      async () => {},
      new InMemoryLedgerReadRepository(),
      createJwtAuthConfig(),
      createRateLimitConfig({
        write: {
          maxRequests: 1,
          windowSeconds: 90,
        },
      }),
    );
    const headers = await authHeaders(server);

    const first = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers,
      payload: {
        name: 'Main ledger',
      },
    });
    const second = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers,
      payload: {
        name: 'Another ledger',
      },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(429);
    expect(
      parsePayload<{ error: string; message: string; retry_after_seconds: number }>(second.body),
    ).toEqual({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Rate limit exceeded',
      retry_after_seconds: 90,
    });
    expect(second.headers['retry-after']).toBe('90');

    await server.close();
  });

  it('GET /v1/* endpoints are not rate limited by POST write baseline', async () => {
    const server = createServer(
      async () => {},
      new InMemoryLedgerReadRepository(),
      createJwtAuthConfig(),
      createRateLimitConfig({
        write: {
          maxRequests: 1,
          windowSeconds: 90,
        },
      }),
    );
    const headers = await authHeaders(server);

    const writeResponse = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers,
      payload: {
        name: 'Main ledger',
      },
    });
    const readResponse = await server.inject({
      method: 'GET',
      url: '/v1/ledgers',
      headers,
    });

    expect(writeResponse.statusCode).toBe(201);
    expect(readResponse.statusCode).toBe(200);
    expect(readResponse.headers['retry-after']).toBeUndefined();

    await server.close();
  });

  it('POST /v1/transactions creates transaction and returns bigint-safe response', async () => {
    const server = createServer();

    const ledgerResponse = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: await authHeaders(server),
      payload: {
        name: 'Main ledger',
      },
    });
    const ledger = parsePayload<Ledger>(ledgerResponse.body);

    const payload = createTransactionRequestFactory(ledger.id);
    payload.description = 'Invoice #1001';

    const response = await server.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: await authHeaders(server),
      payload,
    });

    expect(response.statusCode).toBe(201);
    const createResponse = parsePayload<{ transaction_id: string; created: boolean }>(
      response.body,
    );
    assertCreateTransactionResponseShape(createResponse);
    expect(createResponse.created).toBe(true);
    expect(isUuidV7(createResponse.transaction_id)).toBe(true);

    await server.close();
  });

  it('POST /v1/transactions returns 200 on idempotent retry', async () => {
    const server = createServer();

    const ledgerResponse = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: await authHeaders(server),
      payload: {
        name: 'Main ledger',
      },
    });
    const ledger = parsePayload<Ledger>(ledgerResponse.body);

    const payload = createTransactionRequestFactory(ledger.id, 'txn-ref-idempotent');

    const first = await server.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: await authHeaders(server),
      payload,
    });
    const second = await server.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: await authHeaders(server),
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);

    const firstBody = parsePayload<{ transaction_id: string; created: boolean }>(first.body);
    const secondBody = parsePayload<{ transaction_id: string; created: boolean }>(second.body);
    assertCreateTransactionResponseShape(firstBody);
    assertCreateTransactionResponseShape(secondBody);
    expect(firstBody.transaction_id).toBe(secondBody.transaction_id);
    expect(secondBody.created).toBeFalse();

    await server.close();
  });

  it('POST /v1/transactions accepts omitted description and validates non-empty trimmed description', async () => {
    const server = createServer();

    const ledgerResponse = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: await authHeaders(server),
      payload: {
        name: 'Main ledger',
      },
    });
    const ledger = parsePayload<Ledger>(ledgerResponse.body);

    const withoutDescription = await server.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: await authHeaders(server),
      payload: {
        ledger_id: ledger.id,
        reference: 'txn-ref-no-description',
        currency: 'USD',
        entries: [
          {
            account_id: '00000000-0000-4000-8000-000000000101',
            direction: EntryDirection.DEBIT,
            amount_minor: '100',
            currency: 'USD',
          },
          {
            account_id: '00000000-0000-4000-8000-000000000102',
            direction: EntryDirection.CREDIT,
            amount_minor: '100',
            currency: 'USD',
          },
        ],
      },
    });

    const invalidDescription = await server.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: await authHeaders(server),
      payload: {
        ledger_id: ledger.id,
        reference: 'txn-ref-invalid-description',
        currency: 'USD',
        description: '   ',
        entries: [
          {
            account_id: '00000000-0000-4000-8000-000000000101',
            direction: EntryDirection.DEBIT,
            amount_minor: '100',
            currency: 'USD',
          },
          {
            account_id: '00000000-0000-4000-8000-000000000102',
            direction: EntryDirection.CREDIT,
            amount_minor: '100',
            currency: 'USD',
          },
        ],
      },
    });

    expect(withoutDescription.statusCode).toBe(201);
    expect(invalidDescription.statusCode).toBe(400);

    await server.close();
  });

  it('POST /v1/holds creates hold and supports idempotent retry semantics', async () => {
    const server = createServer();
    const headers = await authHeaders(server);

    const payload = {
      ledger_id: TEST_MAIN_LEDGER_ID,
      reference: 'hold-ref-1',
      currency: 'USD',
      entries: [
        {
          account_id: TEST_DEBIT_ACCOUNT_ID,
          direction: EntryDirection.DEBIT,
          amount_minor: '100',
          currency: 'USD',
        },
        {
          account_id: TEST_CREDIT_ACCOUNT_ID,
          direction: EntryDirection.CREDIT,
          amount_minor: '100',
          currency: 'USD',
        },
      ],
    };

    const created = await server.inject({
      method: 'POST',
      url: '/v1/holds',
      headers,
      payload,
    });
    const retried = await server.inject({
      method: 'POST',
      url: '/v1/holds',
      headers,
      payload,
    });

    expect(created.statusCode).toBe(201);
    expect(retried.statusCode).toBe(201);
    const createdBody = parsePayload<{ hold_id: string; state: string }>(created.body);
    expect(createdBody.hold_id).toBeString();
    expect(createdBody.state).toBe('HELD');

    await server.close();
  });

  it('POST /v1/holds/:id/commit commits hold and returns APPLIED with zero remaining', async () => {
    const server = createServer();
    const headers = await authHeaders(server);
    const createHoldResponse = await server.inject({
      method: 'POST',
      url: '/v1/holds',
      headers,
      payload: {
        ledger_id: TEST_MAIN_LEDGER_ID,
        reference: 'hold-ref-2',
        currency: 'USD',
        entries: [
          {
            account_id: TEST_DEBIT_ACCOUNT_ID,
            direction: EntryDirection.DEBIT,
            amount_minor: '150',
            currency: 'USD',
          },
          {
            account_id: TEST_CREDIT_ACCOUNT_ID,
            direction: EntryDirection.CREDIT,
            amount_minor: '150',
            currency: 'USD',
          },
        ],
      },
    });
    const hold = parsePayload<{ hold_id: string }>(createHoldResponse.body);

    const commitResponse = await server.inject({
      method: 'POST',
      url: `/v1/holds/${hold.hold_id}/commit`,
      headers,
      payload: {
        reference: 'hold-ref-2-commit-1',
      },
    });
    const commitBody = parsePayload<{ state: string; remaining_amount_minor: string }>(
      commitResponse.body,
    );
    expect(commitResponse.statusCode).toBe(201);
    expect(commitBody.state).toBe('APPLIED');
    expect(commitBody.remaining_amount_minor).toBe('0');

    await server.close();
  });

  it('POST /v1/holds/:id/commit supports partial commit with remaining hold amount', async () => {
    const server = createServer();
    const headers = await authHeaders(server);
    const createHoldResponse = await server.inject({
      method: 'POST',
      url: '/v1/holds',
      headers,
      payload: {
        ledger_id: TEST_MAIN_LEDGER_ID,
        reference: 'hold-ref-partial',
        currency: 'USD',
        entries: [
          {
            account_id: TEST_DEBIT_ACCOUNT_ID,
            direction: EntryDirection.DEBIT,
            amount_minor: '200',
            currency: 'USD',
          },
          {
            account_id: TEST_CREDIT_ACCOUNT_ID,
            direction: EntryDirection.CREDIT,
            amount_minor: '200',
            currency: 'USD',
          },
        ],
      },
    });
    const hold = parsePayload<{ hold_id: string }>(createHoldResponse.body);

    const commitResponse = await server.inject({
      method: 'POST',
      url: `/v1/holds/${hold.hold_id}/commit`,
      headers,
      payload: {
        reference: 'hold-ref-partial-commit-1',
        amount_minor: '100',
      },
    });
    const commitBody = parsePayload<{ state: string; remaining_amount_minor: string }>(
      commitResponse.body,
    );
    expect(commitResponse.statusCode).toBe(201);
    expect(commitBody.state).toBe('HELD');
    expect(commitBody.remaining_amount_minor).toBe('100');

    await server.close();
  });

  it('POST /v1/holds/:id/commit is idempotent for concurrent same-reference retries', async () => {
    const server = createServer();
    const headers = await authHeaders(server);
    const createHoldResponse = await server.inject({
      method: 'POST',
      url: '/v1/holds',
      headers,
      payload: {
        ledger_id: TEST_MAIN_LEDGER_ID,
        reference: 'hold-ref-concurrent',
        currency: 'USD',
        entries: [
          {
            account_id: TEST_DEBIT_ACCOUNT_ID,
            direction: EntryDirection.DEBIT,
            amount_minor: '120',
            currency: 'USD',
          },
          {
            account_id: TEST_CREDIT_ACCOUNT_ID,
            direction: EntryDirection.CREDIT,
            amount_minor: '120',
            currency: 'USD',
          },
        ],
      },
    });
    const hold = parsePayload<{ hold_id: string }>(createHoldResponse.body);

    const [first, second] = await Promise.all([
      server.inject({
        method: 'POST',
        url: `/v1/holds/${hold.hold_id}/commit`,
        headers,
        payload: {
          reference: 'hold-ref-concurrent-commit',
        },
      }),
      server.inject({
        method: 'POST',
        url: `/v1/holds/${hold.hold_id}/commit`,
        headers,
        payload: {
          reference: 'hold-ref-concurrent-commit',
        },
      }),
    ]);

    const statuses = [first.statusCode, second.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 201]);
    const firstBody = parsePayload<{ transaction_id: string }>(first.body);
    const secondBody = parsePayload<{ transaction_id: string }>(second.body);
    expect(firstBody.transaction_id).toBe(secondBody.transaction_id);

    await server.close();
  });

  it('POST /v1/holds/:id/void voids remaining hold after partial commit', async () => {
    const server = createServer();
    const headers = await authHeaders(server);
    const createHoldResponse = await server.inject({
      method: 'POST',
      url: '/v1/holds',
      headers,
      payload: {
        ledger_id: TEST_MAIN_LEDGER_ID,
        reference: 'hold-ref-partial-void',
        currency: 'USD',
        entries: [
          {
            account_id: TEST_DEBIT_ACCOUNT_ID,
            direction: EntryDirection.DEBIT,
            amount_minor: '200',
            currency: 'USD',
          },
          {
            account_id: TEST_CREDIT_ACCOUNT_ID,
            direction: EntryDirection.CREDIT,
            amount_minor: '200',
            currency: 'USD',
          },
        ],
      },
    });
    const hold = parsePayload<{ hold_id: string }>(createHoldResponse.body);
    await server.inject({
      method: 'POST',
      url: `/v1/holds/${hold.hold_id}/commit`,
      headers,
      payload: {
        reference: 'hold-ref-partial-void-commit',
        amount_minor: '100',
      },
    });

    const voidResponse = await server.inject({
      method: 'POST',
      url: `/v1/holds/${hold.hold_id}/void`,
      headers,
    });
    const voidBody = parsePayload<{ state: string; remaining_amount_minor: string }>(
      voidResponse.body,
    );
    expect(voidResponse.statusCode).toBe(200);
    expect(voidBody.state).toBe('VOIDED');
    expect(voidBody.remaining_amount_minor).toBe('0');

    await server.close();
  });

  it('GET /v1/ledgers returns tenant ledgers from header context', async () => {
    const server = createServer();

    await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: await authHeaders(server),
      payload: {
        name: 'Main ledger',
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ledgers',
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(200);

    const payload = parsePayload<LedgerResponse[]>(response.body);

    assertLedgersListShape(payload);
    expect(payload.length).toBe(1);
    expect(payload[0]?.name).toBe('Main ledger');

    await server.close();
  });

  it('GET /v1/ledgers/:id returns ledger when found', async () => {
    const server = createServer();

    const createdResponse = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: await authHeaders(server),
      payload: {
        name: 'Main ledger',
      },
    });

    const created = parsePayload<LedgerResponse>(createdResponse.body);
    assertLedgerResponseShape(created);

    const response = await server.inject({
      method: 'GET',
      url: `/v1/ledgers/${created.id}`,
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<LedgerResponse>(response.body);
    assertLedgerResponseShape(payload);
    expect(payload).toEqual(created);

    await server.close();
  });

  it('GET /v1/ledgers/:id returns 404 for ledger of another tenant', async () => {
    const server = createServer();

    const createdResponse = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: await authHeaders(server),
      payload: {
        name: 'Main ledger',
      },
    });

    const created = parsePayload<LedgerResponse>(createdResponse.body);

    const response = await server.inject({
      method: 'GET',
      url: `/v1/ledgers/${created.id}`,
      headers: await authHeaders(server, OTHER_TENANT_ADMIN_API_KEY),
    });

    expect(response.statusCode).toBe(404);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('LEDGER_NOT_FOUND');

    await server.close();
  });

  it('POST /v1/ledgers rejects additional properties', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: await authHeaders(server),
      payload: {
        name: 'Main ledger',
        extra: 'nope',
      },
    });

    expect(response.statusCode).toBe(400);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('INVALID_INPUT');

    await server.close();
  });

  it('GET /v1/ledgers/:id validates uuid format', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ledgers/not-a-uuid',
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(400);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('INVALID_INPUT');

    await server.close();
  });

  it('GET /v1/accounts returns paginated response with bigint as string', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/accounts',
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<AccountsPageResponse>(response.body);
    assertAccountsPageShape(payload);
    expect(payload.data.length).toBe(1);
    expect(payload.data[0]?.id).toBe('00000000-0000-4000-8000-000000000101');
    expect(payload.data[0]?.side).toBe(EntryDirection.DEBIT);
    expect(payload.data[0]?.balance_minor).toBe('100');
    expect(payload.next_cursor).toBe('next-accounts');

    await server.close();
  });

  it('GET /v1/accounts supports tenant-scoped ledger filter', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/accounts?ledger_id=00000000-0000-4000-8000-000000000002',
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<AccountsPageResponse>(response.body);
    assertAccountsPageShape(payload);
    expect(payload.data.length).toBe(1);
    expect(payload.data[0]?.id).toBe('00000000-0000-4000-8000-000000000103');
    expect(payload.data[0]?.ledger_id).toBe('00000000-0000-4000-8000-000000000002');
    expect(payload.next_cursor).toBeNull();

    await server.close();
  });

  it('POST /v1/accounts creates account', async () => {
    const server = createServer();

    const createLedgerResponse = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: await authHeaders(server),
      payload: {
        name: 'Main',
      },
    });
    expect(createLedgerResponse.statusCode).toBe(201);
    const createdLedger = parsePayload<Ledger>(createLedgerResponse.body);

    const requestBody: CreateAccountRequest = createAccountRequestFactory(createdLedger.id);
    const response = await server.inject({
      method: 'POST',
      url: '/v1/accounts',
      headers: await authHeaders(server),
      payload: requestBody,
    });

    expect(response.statusCode).toBe(201);
    const payload = parsePayload<AccountResponse>(response.body);
    assertAccountResponseShape(payload);
    expect(payload.id).toBeString();
    expect(payload.tenant_id).toBe(VALID_TENANT_ID);
    expect(payload.ledger_id).toBe(createdLedger.id);
    expect(payload.name).toBe('Cash');
    expect(payload.side).toBe(AccountSide.DEBIT);
    expect(payload.currency).toBe('USD');
    expect(payload.balance_minor).toBe('0');

    await server.close();
  });

  it('POST /v1/accounts returns 404 when ledger is missing for tenant', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/accounts',
      headers: await authHeaders(server),
      payload: {
        ledger_id: UNKNOWN_LEDGER_ID,
        name: 'Cash',
        side: AccountSide.DEBIT,
        overdraft_policy: 'ALLOW',
        currency: 'USD',
      },
    });

    expect(response.statusCode).toBe(404);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('LEDGER_NOT_FOUND');

    await server.close();
  });

  it('POST /v1/accounts validates required fields', async () => {
    const server = createServer();

    const createLedgerResponse = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: await authHeaders(server),
      payload: {
        name: 'Main',
      },
    });
    expect(createLedgerResponse.statusCode).toBe(201);
    const createdLedger = parsePayload<Ledger>(createLedgerResponse.body);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/accounts',
      headers: await authHeaders(server),
      payload: {
        ledger_id: createdLedger.id,
        name: ' ',
        side: AccountSide.DEBIT,
        overdraft_policy: 'ALLOW',
        currency: '',
      },
    });

    expect(response.statusCode).toBe(400);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('INVALID_INPUT');

    await server.close();
  });

  it('POST /v1/accounts validates side at route contract level', async () => {
    const server = createServer();

    const createLedgerResponse = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: await authHeaders(server),
      payload: {
        name: 'Main',
      },
    });
    expect(createLedgerResponse.statusCode).toBe(201);
    const createdLedger = parsePayload<Ledger>(createLedgerResponse.body);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/accounts',
      headers: await authHeaders(server),
      payload: {
        ledger_id: createdLedger.id,
        name: 'Cash',
        side: 'INVALID',
        overdraft_policy: 'ALLOW',
        currency: 'USD',
      },
    });

    expect(response.statusCode).toBe(400);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('INVALID_INPUT');

    await server.close();
  });

  it('GET /v1/accounts/:id returns account when found', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/accounts/00000000-0000-4000-8000-000000000101',
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<AccountResponse>(response.body);
    assertAccountResponseShape(payload);
    expect(payload.id).toBe('00000000-0000-4000-8000-000000000101');
    expect(payload.tenant_id).toBe(VALID_TENANT_ID);

    await server.close();
  });

  it('GET /v1/accounts/:id returns 404 for missing/cross-tenant account', async () => {
    const server = createServer();

    const missingResponse = await server.inject({
      method: 'GET',
      url: '/v1/accounts/00000000-0000-4000-8000-999999999999',
      headers: await authHeaders(server),
    });
    expect(missingResponse.statusCode).toBe(404);
    const missingPayload = parsePayload<{ error: string }>(missingResponse.body);
    expect(missingPayload.error).toBe('ACCOUNT_NOT_FOUND');

    const crossTenantResponse = await server.inject({
      method: 'GET',
      url: '/v1/accounts/00000000-0000-4000-8000-000000000101',
      headers: await authHeaders(server, OTHER_TENANT_ADMIN_API_KEY),
    });
    expect(crossTenantResponse.statusCode).toBe(404);
    const crossTenantPayload = parsePayload<{ error: string }>(crossTenantResponse.body);
    expect(crossTenantPayload.error).toBe('ACCOUNT_NOT_FOUND');

    await server.close();
  });

  it('GET /v1/transactions/:id returns transaction when found', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/transactions/00000000-0000-4000-8000-000000000201',
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<TransactionResponse>(response.body);
    assertTransactionResponseShape(payload);
    expect(payload.id).toBe('00000000-0000-4000-8000-000000000201');
    expect(payload.tenant_id).toBe(VALID_TENANT_ID);
    expect(payload.reference).toBe('tx-ref-1');
    expect(payload.description).toBe('Payment settlement');

    await server.close();
  });

  it('GET /v1/transactions/:id returns 404 for missing/cross-tenant transaction', async () => {
    const server = createServer();

    const missingResponse = await server.inject({
      method: 'GET',
      url: '/v1/transactions/00000000-0000-4000-8000-999999999999',
      headers: await authHeaders(server),
    });
    expect(missingResponse.statusCode).toBe(404);
    const missingPayload = parsePayload<{ error: string }>(missingResponse.body);
    expect(missingPayload.error).toBe('TRANSACTION_NOT_FOUND');

    const crossTenantResponse = await server.inject({
      method: 'GET',
      url: '/v1/transactions/00000000-0000-4000-8000-000000000201',
      headers: await authHeaders(server, OTHER_TENANT_ADMIN_API_KEY),
    });
    expect(crossTenantResponse.statusCode).toBe(404);
    const crossTenantPayload = parsePayload<{ error: string }>(crossTenantResponse.body);
    expect(crossTenantPayload.error).toBe('TRANSACTION_NOT_FOUND');

    await server.close();
  });

  it('GET /v1/transactions supports tenant-scoped ledger filter', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/transactions?ledger_id=00000000-0000-4000-8000-000000000002',
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<TransactionsPage>(response.body);
    assertTransactionsPageShape(payload);
    expect(payload.data).toEqual([]);
    expect(payload.next_cursor).toBeNull();

    await server.close();
  });

  it('GET /v1/transactions validates ledger_id format', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/transactions?ledger_id=invalid-ledger-id',
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(400);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('INVALID_INPUT');

    await server.close();
  });

  it('GET /v1/transactions supports cursor pagination', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/transactions?cursor=next-transactions&limit=1',
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<TransactionsPage>(response.body);
    assertTransactionsPageShape(payload);
    expect(payload.data.length).toBe(1);
    const firstTransaction = payload.data[0];
    if (!firstTransaction) {
      throw new Error('expected first transaction item in paginated response');
    }
    assertTransactionResponseShape(firstTransaction);
    expect(firstTransaction.id).toBe('00000000-0000-4000-8000-000000000202');
    expect(firstTransaction.description).toBeNull();
    expect(payload.next_cursor).toBeNull();

    await server.close();
  });

  it('GET /v1/entries supports cursor pagination with amount as string', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/entries?cursor=next-entries&limit=1',
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<EntriesPageResponse>(response.body);
    assertEntriesPageShape(payload);
    assertEntryResponseShape(payload.data[0] as EntryResponse);
    expect(payload.data.length).toBe(1);
    expect(payload.data[0]?.id).toBe('00000000-0000-4000-8000-000000000302');
    expect(payload.data[0]?.amount_minor).toBe('123');
    expect(payload.next_cursor).toBeNull();

    await server.close();
  });

  it('GET /v1/entries returns 400 when read model contains non-persisted entry fields', async () => {
    const invalidReadRepository = {
      findAccountByIdForTenant: async (
        _tenantId: string,
        _accountId: string,
      ): Promise<AccountEntity | null> => null,
      findTransactionByIdForTenant: async (
        _tenantId: string,
        _transactionId: string,
      ): Promise<TransactionEntity | null> => null,
      listAccounts: async (
        _query: AccountPaginationQuery,
      ): Promise<PaginatedResult<AccountEntity>> => ({
        data: [],
        nextCursor: null,
      }),
      listTransactions: async (
        _query: TransactionPaginationQuery,
      ): Promise<PaginatedResult<TransactionEntity>> => ({
        data: [],
        nextCursor: null,
      }),
      listEntries: async (_query: PaginationQuery): Promise<PaginatedResult<EntryEntity>> => ({
        data: [
          new EntryEntity({
            id: '00000000-0000-4000-8000-000000000399',
            transactionId: null,
            accountId: new AccountId('00000000-0000-4000-8000-000000000101'),
            direction: EntryDirection.DEBIT,
            money: Money.of(1n, 'USD'),
            createdAt: null,
          }),
        ],
        nextCursor: null,
      }),
      getLedgerTrialBalance: async (_query: LedgerTrialBalanceQuery): Promise<TrialBalance> => ({
        ledgerId: '00000000-0000-4000-8000-000000000001',
        accounts: [],
        totalDebitsMinor: 0n,
        totalCreditsMinor: 0n,
      }),
      getBalanceAt: async (query: BalanceAtQuery): Promise<HistoricalBalance> => ({
        tenantId: query.tenantId,
        accountId: query.accountId,
        at: query.at,
        postedMinor: 0n,
        inflightDebitMinor: 0n,
        inflightCreditMinor: 0n,
        availableMinor: 0n,
      }),
      listBalanceHistory: async (
        _query: BalanceHistoryQuery,
      ): Promise<PaginatedResult<BalanceSnapshotEvent>> => ({ data: [], nextCursor: null }),
    };

    const server = createServer(async () => {}, invalidReadRepository);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/entries',
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(400);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('INVARIANT_VIOLATION');

    await server.close();
  });

  it('GET /v1/accounts validates limit upper bound', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/accounts?limit=201',
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(400);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('INVALID_INPUT');

    await server.close();
  });

  it('GET /v1/accounts requires bearer token header', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/accounts',
    });

    expect(response.statusCode).toBe(401);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('UNAUTHORIZED');

    await server.close();
  });

  it('GET /v1/accounts/:id/balance-history returns first page and next cursor', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: `/v1/accounts/${TEST_DEBIT_ACCOUNT_ID}/balance-history?from=2026-01-01T00:00:00.000Z&to=2026-01-01T00:20:00.000Z&limit=2`,
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<{
      data: Array<{ event_type: string; effective_at: string }>;
      next_cursor: string | null;
    }>(response.body);
    expect(payload.data.length).toBe(2);
    expect(payload.data[0]?.event_type).toBe('HOLD_CREATED');
    expect(payload.data[1]?.event_type).toBe('HOLD_COMMITTED');
    expect(payload.next_cursor).toBe('hist-cursor-1');

    await server.close();
  });

  it('GET /v1/accounts/:id/balance-history supports cursor pagination end-to-end', async () => {
    const server = createServer();

    const first = await server.inject({
      method: 'GET',
      url: `/v1/accounts/${TEST_DEBIT_ACCOUNT_ID}/balance-history?from=2026-01-01T00:00:00.000Z&to=2026-01-01T00:20:00.000Z&limit=2`,
      headers: await authHeaders(server),
    });
    const firstPayload = parsePayload<{ next_cursor: string | null }>(first.body);

    const second = await server.inject({
      method: 'GET',
      url: `/v1/accounts/${TEST_DEBIT_ACCOUNT_ID}/balance-history?from=2026-01-01T00:00:00.000Z&to=2026-01-01T00:20:00.000Z&limit=2&cursor=${firstPayload.next_cursor}`,
      headers: await authHeaders(server),
    });

    expect(second.statusCode).toBe(200);
    const secondPayload = parsePayload<{
      data: Array<{ event_type: string }>;
      next_cursor: string | null;
    }>(second.body);
    expect(secondPayload.data.length).toBe(1);
    expect(secondPayload.data[0]?.event_type).toBe('TX_APPLIED');
    expect(secondPayload.next_cursor).toBeNull();

    await server.close();
  });

  it('GET /v1/accounts/:id/balance-history returns empty list for range before snapshots', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: `/v1/accounts/${TEST_DEBIT_ACCOUNT_ID}/balance-history?from=2025-01-01T00:00:00.000Z&to=2025-01-01T00:05:00.000Z&limit=10`,
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<{ data: unknown[]; next_cursor: string | null }>(response.body);
    expect(payload.data.length).toBe(0);
    expect(payload.next_cursor).toBeNull();

    await server.close();
  });

  it('GET /v1/ledgers/:ledger_id/trial-balance returns trial balance with string amounts', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ledgers/00000000-0000-4000-8000-000000000001/trial-balance',
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<TrialBalanceResponse>(response.body);
    assertTrialBalanceResponseShape(payload);

    expect(payload.ledger_id).toBe('00000000-0000-4000-8000-000000000001');
    expect(payload.accounts.length).toBe(2);
    expect(payload.accounts[0]?.balance).toBe('100');
    expect(payload.accounts[0]?.is_contra).toBeFalse();
    expect(payload.total_debits).toBe('100');
    expect(payload.total_credits).toBe('100');

    await server.close();
  });

  it('GET /v1/ledgers/:ledger_id/trial-balance validates ledger_id format', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ledgers/not-a-uuid/trial-balance',
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(400);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('INVALID_INPUT');

    await server.close();
  });

  it('GET /v1/ledgers/:ledger_id/trial-balance returns 404 for missing ledger', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: `/v1/ledgers/${UNKNOWN_LEDGER_ID}/trial-balance`,
      headers: await authHeaders(server),
    });

    expect(response.statusCode).toBe(404);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload).toEqual({
      error: 'LEDGER_NOT_FOUND',
      message: `Ledger not found: ${UNKNOWN_LEDGER_ID}`,
    });

    await server.close();
  });

  it('GET /v1/ledgers/:ledger_id/trial-balance returns 404 for wrong tenant context', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ledgers/00000000-0000-4000-8000-000000000001/trial-balance',
      headers: await authHeaders(server, OTHER_TENANT_ADMIN_API_KEY),
    });

    expect(response.statusCode).toBe(404);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('LEDGER_NOT_FOUND');

    await server.close();
  });

  it('GET /v1/admin/api-keys rejects non-admin API key', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/admin/api-keys',
      headers: await authHeaders(server, VALID_SERVICE_API_KEY),
    });

    expect(response.statusCode).toBe(403);
    expect(parsePayload<{ error: string }>(response.body).error).toBe('FORBIDDEN');

    await server.close();
  });

  it('POST /v1/admin/api-keys creates key for tenant', async () => {
    const server = createServer();

    const requestPayload: CreateApiKeyRequest = createApiKeyRequestFactory(
      'New service key',
      ApiKeyRole.SERVICE,
    );
    const response = await server.inject({
      method: 'POST',
      url: '/v1/admin/api-keys',
      headers: await authHeaders(server),
      payload: requestPayload,
    });

    expect(response.statusCode).toBe(201);
    const payload = parsePayload<CreateApiKeyResponse>(response.body);
    assertCreateApiKeyResponseShape(payload);
    expect(payload.api_key.startsWith('llk_')).toBeTrue();
    expect(payload.key.tenant_id).toBe(VALID_TENANT_ID);
    expect(payload.key.role).toBe(ApiKeyRole.SERVICE);

    await server.close();
  });

  it('POST /v1/admin/api-keys/:id/revoke revokes existing key', async () => {
    const server = createServer();

    const created = await server.inject({
      method: 'POST',
      url: '/v1/admin/api-keys',
      headers: await authHeaders(server),
      payload: {
        name: 'Revoke me',
        role: ApiKeyRole.SERVICE,
      },
    });
    const createdPayload = parsePayload<{ key: { id: string } }>(created.body);

    const revokeResponse = await server.inject({
      method: 'POST',
      url: `/v1/admin/api-keys/${createdPayload.key.id}/revoke`,
      headers: await authHeaders(server),
    });

    expect(revokeResponse.statusCode).toBe(204);

    await server.close();
  });

  it('POST /v1/auth/token rejects revoked api key', async () => {
    const server = createServer();

    const created = await server.inject({
      method: 'POST',
      url: '/v1/admin/api-keys',
      headers: await authHeaders(server),
      payload: {
        name: 'Short lived service',
        role: ApiKeyRole.SERVICE,
      },
    });
    expect(created.statusCode).toBe(201);
    const createdPayload = parsePayload<{ api_key: string; key: { id: string } }>(created.body);

    const revokeResponse = await server.inject({
      method: 'POST',
      url: `/v1/admin/api-keys/${createdPayload.key.id}/revoke`,
      headers: await authHeaders(server),
    });
    expect(revokeResponse.statusCode).toBe(204);

    const tokenResponse = await server.inject({
      method: 'POST',
      url: '/v1/auth/token',
      headers: {
        'x-api-key': createdPayload.api_key,
      },
    });

    expect(tokenResponse.statusCode).toBe(401);
    expect(parsePayload<{ error: string }>(tokenResponse.body).error).toBe('UNAUTHORIZED');

    await server.close();
  });

  it('issued token works before revocation and is rejected after revocation', async () => {
    const server = createServer();

    const created = await server.inject({
      method: 'POST',
      url: '/v1/admin/api-keys',
      headers: await authHeaders(server),
      payload: {
        name: 'Short lived service',
        role: ApiKeyRole.SERVICE,
      },
    });
    expect(created.statusCode).toBe(201);
    const createdPayload = parsePayload<{ api_key: string; key: { id: string } }>(created.body);

    const token = await issueToken(server, createdPayload.api_key);

    const preRevokeResponse = await server.inject({
      method: 'GET',
      url: '/v1/ledgers',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(preRevokeResponse.statusCode).toBe(200);

    const revokeResponse = await server.inject({
      method: 'POST',
      url: `/v1/admin/api-keys/${createdPayload.key.id}/revoke`,
      headers: await authHeaders(server),
    });
    expect(revokeResponse.statusCode).toBe(204);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ledgers',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(parsePayload<{ error: string }>(response.body).error).toBe('UNAUTHORIZED');

    await server.close();
  });

  describe('fastify adapter parity guardrails', () => {
    it('keeps route-level validation mapping for adapter-registered account creation', async () => {
      const server = createServer();

      const response = await server.inject({
        method: 'POST',
        url: '/v1/accounts',
        headers: await authHeaders(server),
        payload: {
          name: 'Broken request',
          side: 'DEBIT',
          overdraft_policy: 'ALLOW',
          currency: 'USD',
        },
      });

      expect(response.statusCode).toBe(400);
      const payload = parsePayload<{ error: string; message: string }>(response.body);
      expect(payload.error).toBe('INVALID_INPUT');
      expect(payload.message.length).toBeGreaterThan(0);

      await server.close();
    });

    it('keeps idempotent create transaction status semantics for adapter-registered route', async () => {
      const server = createServer();
      const headers = await authHeaders(server);

      const ledgerResponse = await server.inject({
        method: 'POST',
        url: '/v1/ledgers',
        headers,
        payload: {
          name: 'Adapter parity ledger',
        },
      });
      const ledger = parsePayload<Ledger>(ledgerResponse.body);
      const payload = createTransactionRequestFactory(ledger.id, 'adapter-parity-ref');

      const first = await server.inject({
        method: 'POST',
        url: '/v1/transactions',
        headers,
        payload,
      });
      expect(first.statusCode).toBe(201);

      const second = await server.inject({
        method: 'POST',
        url: '/v1/transactions',
        headers,
        payload,
      });

      expect(second.statusCode).toBe(200);
      expect(parsePayload<{ created: boolean }>(second.body).created).toBeFalse();

      await server.close();
    });
  });
});

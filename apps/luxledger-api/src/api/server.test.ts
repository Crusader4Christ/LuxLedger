import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';

import { createServerCore, registerApplication } from '@api/server';
import type { AccountEntity, ApiKeyEntity } from '@lux/ledger';
import {
  AccountId,
  ApiKeyRole,
  EntryEntity,
  LedgerId,
  Money,
  TransactionEntity,
  TransactionId,
} from '@lux/ledger';
import { ApiKeyService } from '@services/api-key-service';
import { InvariantViolationError, LedgerNotFoundError, RepositoryError } from '@services/errors';
import { LedgerService } from '@services/ledger-service';
import type {
  ApiKeyRepository,
  CreateLedgerInput,
  CreateTransactionInput,
  CreateTransactionResult,
  Ledger,
  LedgerRepository,
  PaginatedResult,
  PaginationQuery,
  TrialBalance,
  TrialBalanceQuery,
} from '@services/types';
import { EntryDirection } from '@services/types';

class InMemoryLedgerRepository {
  private readonly ledgers = new Map<string, Ledger>();
  private readonly transactionsByReference = new Map<string, string>();

  public async createLedger(input: CreateLedgerInput): Promise<Ledger> {
    if (input.name === 'force-db-error') {
      throw new RepositoryError('forced repository error');
    }

    const now = new Date();
    const id = `00000000-0000-4000-8000-${String(this.ledgers.size + 1).padStart(12, '0')}`;
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

    const transactionId = `00000000-0000-4000-8000-${String(this.transactionsByReference.size + 300).padStart(12, '0')}`;
    this.transactionsByReference.set(key, transactionId);

    return {
      transactionId,
      created: true,
    };
  }
}

class InMemoryLedgerReadRepository {
  public async listAccounts(query: PaginationQuery): Promise<PaginatedResult<AccountEntity>> {
    const account1: AccountEntity = {
      id: '00000000-0000-4000-8000-000000000101',
      tenantId: VALID_TENANT_ID,
      ledgerId: '00000000-0000-4000-8000-000000000001',
      name: 'Cash',
      side: EntryDirection.DEBIT,
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
      currency: 'USD',
      balanceMinor: 200n,
      createdAt: new Date('2026-01-01T00:00:01.000Z'),
    };

    if (query.tenantId !== VALID_TENANT_ID) {
      return { data: [], nextCursor: null };
    }

    if (query.cursor === 'next-accounts') {
      return { data: [account2], nextCursor: null };
    }

    return { data: [account1], nextCursor: 'next-accounts' };
  }

  public async listTransactions(
    query: PaginationQuery,
  ): Promise<PaginatedResult<TransactionEntity>> {
    const transaction1 = new TransactionEntity({
      id: new TransactionId('00000000-0000-4000-8000-000000000201'),
      tenantId: VALID_TENANT_ID,
      ledgerId: new LedgerId('00000000-0000-4000-8000-000000000001'),
      reference: 'tx-ref-1',
      currency: 'USD',
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

    if (query.cursor === 'next-transactions') {
      return { data: [transaction2], nextCursor: null };
    }

    return { data: [transaction1], nextCursor: 'next-transactions' };
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

  public async getTrialBalance(query: TrialBalanceQuery): Promise<TrialBalance> {
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
    const id = `00000000-0000-4000-8000-${String(this.keys.size + 904).padStart(12, '0')}`;
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
  listAccounts(query: PaginationQuery): Promise<PaginatedResult<AccountEntity>>;
  listTransactions(query: PaginationQuery): Promise<PaginatedResult<TransactionEntity>>;
  listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryEntity>>;
  getTrialBalance(query: TrialBalanceQuery): Promise<TrialBalance>;
}

const createServer = (
  readinessCheck: () => Promise<void> = async () => {},
  readRepository: ReadRepositoryPort = new InMemoryLedgerReadRepository(),
) => {
  const writeRepository = new InMemoryLedgerRepository();
  const repository: LedgerRepository = {
    createLedger: writeRepository.createLedger.bind(writeRepository),
    findLedgerByIdForTenant: writeRepository.findLedgerByIdForTenant.bind(writeRepository),
    findLedgersByTenant: writeRepository.findLedgersByTenant.bind(writeRepository),
    createTransaction: writeRepository.createTransaction.bind(writeRepository),
    listAccounts: readRepository.listAccounts.bind(readRepository),
    listTransactions: readRepository.listTransactions.bind(readRepository),
    listEntries: readRepository.listEntries.bind(readRepository),
    getTrialBalance: readRepository.getTrialBalance.bind(readRepository),
  };
  const apiKeyRepository = new InMemoryApiKeyRepository();
  const apiKeyService = new ApiKeyService(apiKeyRepository);
  const ledgerService = new LedgerService(repository);

  const server = createServerCore({
    readinessCheck,
    logger: false,
  });

  registerApplication(server, {
    apiKeyService,
    ledgerService,
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
const ADMIN_AUTH_HEADERS = { 'x-api-key': VALID_ADMIN_API_KEY };

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
      headers: ADMIN_AUTH_HEADERS,
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
      headers: ADMIN_AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(404);
    expect(parsePayload<{ error: string; message: string }>(response.body)).toEqual({
      error: 'LEDGER_NOT_FOUND',
      message: `Ledger not found: ${UNKNOWN_LEDGER_ID}`,
    });

    await server.close();
  });

  it('GET /v1/ledgers requires x-api-key header', async () => {
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

  it('GET /v1/ledgers rejects invalid x-api-key', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ledgers',
      headers: { 'x-api-key': INVALID_API_KEY },
    });

    expect(response.statusCode).toBe(401);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('UNAUTHORIZED');

    await server.close();
  });

  it('POST /v1/ledgers maps repository failures to 500', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: ADMIN_AUTH_HEADERS,
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
      headers: ADMIN_AUTH_HEADERS,
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

  it('POST /v1/transactions creates transaction and returns bigint-safe response', async () => {
    const server = createServer();

    const ledgerResponse = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: ADMIN_AUTH_HEADERS,
      payload: {
        name: 'Main ledger',
      },
    });
    const ledger = parsePayload<Ledger>(ledgerResponse.body);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: ADMIN_AUTH_HEADERS,
      payload: {
        ledger_id: ledger.id,
        reference: 'txn-ref-1',
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

    expect(response.statusCode).toBe(201);
    expect(parsePayload<{ transaction_id: string; created: boolean }>(response.body)).toEqual({
      transaction_id: '00000000-0000-4000-8000-000000000300',
      created: true,
    });

    await server.close();
  });

  it('POST /v1/transactions returns 200 on idempotent retry', async () => {
    const server = createServer();

    const ledgerResponse = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: ADMIN_AUTH_HEADERS,
      payload: {
        name: 'Main ledger',
      },
    });
    const ledger = parsePayload<Ledger>(ledgerResponse.body);

    const payload = {
      ledger_id: ledger.id,
      reference: 'txn-ref-idempotent',
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
    };

    const first = await server.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: ADMIN_AUTH_HEADERS,
      payload,
    });
    const second = await server.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: ADMIN_AUTH_HEADERS,
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);

    const firstBody = parsePayload<{ transaction_id: string; created: boolean }>(first.body);
    const secondBody = parsePayload<{ transaction_id: string; created: boolean }>(second.body);
    expect(firstBody.transaction_id).toBe(secondBody.transaction_id);
    expect(secondBody.created).toBeFalse();

    await server.close();
  });

  it('GET /v1/ledgers returns tenant ledgers from header context', async () => {
    const server = createServer();

    await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: ADMIN_AUTH_HEADERS,
      payload: {
        name: 'Main ledger',
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ledgers',
      headers: ADMIN_AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);

    const payload = parsePayload<Ledger[]>(response.body);

    expect(payload.length).toBe(1);
    expect(payload[0]?.name).toBe('Main ledger');

    await server.close();
  });

  it('GET /v1/ledgers/:id returns ledger when found', async () => {
    const server = createServer();

    const createdResponse = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: ADMIN_AUTH_HEADERS,
      payload: {
        name: 'Main ledger',
      },
    });

    const created = parsePayload<Ledger>(createdResponse.body);

    const response = await server.inject({
      method: 'GET',
      url: `/v1/ledgers/${created.id}`,
      headers: ADMIN_AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    expect(parsePayload<Ledger>(response.body)).toEqual(created);

    await server.close();
  });

  it('GET /v1/ledgers/:id returns 404 for ledger of another tenant', async () => {
    const server = createServer();

    const createdResponse = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      headers: ADMIN_AUTH_HEADERS,
      payload: {
        name: 'Main ledger',
      },
    });

    const created = parsePayload<Ledger>(createdResponse.body);

    const response = await server.inject({
      method: 'GET',
      url: `/v1/ledgers/${created.id}`,
      headers: { 'x-api-key': OTHER_TENANT_ADMIN_API_KEY },
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
      headers: ADMIN_AUTH_HEADERS,
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
      headers: ADMIN_AUTH_HEADERS,
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
      headers: ADMIN_AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<{
      data: Array<{ id: string; side: EntryDirection; balance_minor: string }>;
      next_cursor: string | null;
    }>(response.body);
    expect(payload.data.length).toBe(1);
    expect(payload.data[0]?.id).toBe('00000000-0000-4000-8000-000000000101');
    expect(payload.data[0]?.side).toBe(EntryDirection.DEBIT);
    expect(payload.data[0]?.balance_minor).toBe('100');
    expect(payload.next_cursor).toBe('next-accounts');

    await server.close();
  });

  it('GET /v1/transactions supports cursor pagination', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/transactions?cursor=next-transactions&limit=1',
      headers: ADMIN_AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<{
      data: Array<{ id: string; reference: string }>;
      next_cursor: string | null;
    }>(response.body);
    expect(payload.data.length).toBe(1);
    expect(payload.data[0]?.id).toBe('00000000-0000-4000-8000-000000000202');
    expect(payload.next_cursor).toBeNull();

    await server.close();
  });

  it('GET /v1/entries supports cursor pagination with amount as string', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/entries?cursor=next-entries&limit=1',
      headers: ADMIN_AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<{
      data: Array<{ id: string; amount_minor: string }>;
      next_cursor: string | null;
    }>(response.body);
    expect(payload.data.length).toBe(1);
    expect(payload.data[0]?.id).toBe('00000000-0000-4000-8000-000000000302');
    expect(payload.data[0]?.amount_minor).toBe('123');
    expect(payload.next_cursor).toBeNull();

    await server.close();
  });

  it('GET /v1/entries returns 400 when read model contains non-persisted entry fields', async () => {
    const invalidReadRepository = {
      listAccounts: async (_query: PaginationQuery): Promise<PaginatedResult<AccountEntity>> => ({
        data: [],
        nextCursor: null,
      }),
      listTransactions: async (
        _query: PaginationQuery,
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
      getTrialBalance: async (_query: TrialBalanceQuery): Promise<TrialBalance> => ({
        ledgerId: '00000000-0000-4000-8000-000000000001',
        accounts: [],
        totalDebitsMinor: 0n,
        totalCreditsMinor: 0n,
      }),
    };

    const server = createServer(async () => {}, invalidReadRepository);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/entries',
      headers: ADMIN_AUTH_HEADERS,
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
      headers: ADMIN_AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(400);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('INVALID_INPUT');

    await server.close();
  });

  it('GET /v1/accounts requires x-api-key header', async () => {
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

  it('GET /v1/ledgers/:ledger_id/trial-balance returns trial balance with string amounts', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ledgers/00000000-0000-4000-8000-000000000001/trial-balance',
      headers: ADMIN_AUTH_HEADERS,
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<{
      ledger_id: string;
      accounts: Array<{
        account_id: string;
        code: string;
        name: string;
        normal_balance: EntryDirection;
        balance: string;
        is_contra: boolean;
      }>;
      total_debits: string;
      total_credits: string;
    }>(response.body);

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
      headers: ADMIN_AUTH_HEADERS,
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
      headers: ADMIN_AUTH_HEADERS,
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
      headers: { 'x-api-key': OTHER_TENANT_ADMIN_API_KEY },
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
      headers: { 'x-api-key': VALID_SERVICE_API_KEY },
    });

    expect(response.statusCode).toBe(403);
    expect(parsePayload<{ error: string }>(response.body).error).toBe('FORBIDDEN');

    await server.close();
  });

  it('POST /v1/admin/api-keys creates key for tenant', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/admin/api-keys',
      headers: ADMIN_AUTH_HEADERS,
      payload: {
        name: 'New service key',
        role: ApiKeyRole.SERVICE,
      },
    });

    expect(response.statusCode).toBe(201);
    const payload = parsePayload<{ api_key: string; key: { tenant_id: string; role: string } }>(
      response.body,
    );
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
      headers: ADMIN_AUTH_HEADERS,
      payload: {
        name: 'Revoke me',
        role: ApiKeyRole.SERVICE,
      },
    });
    const createdPayload = parsePayload<{ key: { id: string } }>(created.body);

    const revokeResponse = await server.inject({
      method: 'POST',
      url: `/v1/admin/api-keys/${createdPayload.key.id}/revoke`,
      headers: ADMIN_AUTH_HEADERS,
    });

    expect(revokeResponse.statusCode).toBe(204);

    await server.close();
  });
});

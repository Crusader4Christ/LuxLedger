import { describe, expect, it } from 'bun:test';

import { buildServer } from '@api/server';
import { LedgerNotFoundError, RepositoryError } from '@core/errors';
import { LedgerService } from '@core/ledger-service';
import { LedgerReadService } from '@core/read-service';
import type {
  AccountListItem,
  CreateLedgerInput,
  EntryListItem,
  Ledger,
  LedgerReadRepository,
  LedgerRepository,
  PaginatedResult,
  PaginationQuery,
  PostTransactionInput,
  PostTransactionResult,
  TransactionListItem,
  TrialBalance,
} from '@core/types';

class InMemoryLedgerRepository implements LedgerRepository {
  private readonly ledgers = new Map<string, Ledger>();

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

  public async findLedgerById(id: string): Promise<Ledger | null> {
    return this.ledgers.get(id) ?? null;
  }

  public async findLedgersByTenant(tenantId: string): Promise<Ledger[]> {
    return [...this.ledgers.values()].filter((ledger) => ledger.tenantId === tenantId);
  }

  public async postTransaction(_: PostTransactionInput): Promise<PostTransactionResult> {
    throw new Error('postTransaction is not used in server tests');
  }
}

class InMemoryLedgerReadRepository implements LedgerReadRepository {
  public async listAccounts(query: PaginationQuery): Promise<PaginatedResult<AccountListItem>> {
    const account1: AccountListItem = {
      id: '00000000-0000-4000-8000-000000000101',
      tenantId: VALID_TENANT_ID,
      ledgerId: '00000000-0000-4000-8000-000000000001',
      name: 'Cash',
      currency: 'USD',
      balanceMinor: 100n,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const account2: AccountListItem = {
      id: '00000000-0000-4000-8000-000000000102',
      tenantId: VALID_TENANT_ID,
      ledgerId: '00000000-0000-4000-8000-000000000001',
      name: 'Revenue',
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
  ): Promise<PaginatedResult<TransactionListItem>> {
    const transaction1: TransactionListItem = {
      id: '00000000-0000-4000-8000-000000000201',
      tenantId: VALID_TENANT_ID,
      ledgerId: '00000000-0000-4000-8000-000000000001',
      reference: 'tx-ref-1',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:01:00.000Z'),
    };
    const transaction2: TransactionListItem = {
      id: '00000000-0000-4000-8000-000000000202',
      tenantId: VALID_TENANT_ID,
      ledgerId: '00000000-0000-4000-8000-000000000001',
      reference: 'tx-ref-2',
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:01:01.000Z'),
    };

    if (query.tenantId !== VALID_TENANT_ID) {
      return { data: [], nextCursor: null };
    }

    if (query.cursor === 'next-transactions') {
      return { data: [transaction2], nextCursor: null };
    }

    return { data: [transaction1], nextCursor: 'next-transactions' };
  }

  public async listEntries(query: PaginationQuery): Promise<PaginatedResult<EntryListItem>> {
    const entry1: EntryListItem = {
      id: '00000000-0000-4000-8000-000000000301',
      transactionId: '00000000-0000-4000-8000-000000000201',
      accountId: '00000000-0000-4000-8000-000000000101',
      direction: 'DEBIT',
      amountMinor: 123n,
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:02:00.000Z'),
    };
    const entry2: EntryListItem = {
      id: '00000000-0000-4000-8000-000000000302',
      transactionId: '00000000-0000-4000-8000-000000000201',
      accountId: '00000000-0000-4000-8000-000000000102',
      direction: 'CREDIT',
      amountMinor: 123n,
      currency: 'USD',
      createdAt: new Date('2026-01-01T00:02:01.000Z'),
    };

    if (query.tenantId !== VALID_TENANT_ID) {
      return { data: [], nextCursor: null };
    }

    if (query.cursor === 'next-entries') {
      return { data: [entry2], nextCursor: null };
    }

    return { data: [entry1], nextCursor: 'next-entries' };
  }

  public async getTrialBalance(ledgerId: string): Promise<TrialBalance> {
    if (ledgerId === UNKNOWN_LEDGER_ID) {
      throw new LedgerNotFoundError(ledgerId);
    }

    return {
      ledgerId,
      accounts: [
        {
          accountId: '00000000-0000-4000-8000-000000000101',
          code: '1000',
          name: 'Cash',
          normalBalance: 'DEBIT',
          balanceMinor: 100n,
        },
        {
          accountId: '00000000-0000-4000-8000-000000000102',
          code: '4000',
          name: 'Revenue',
          normalBalance: 'CREDIT',
          balanceMinor: 100n,
        },
      ],
      totalDebitsMinor: 100n,
      totalCreditsMinor: 100n,
    };
  }
}

const createServer = () => {
  const repository = new InMemoryLedgerRepository();
  const ledgerService = new LedgerService(repository);
  const readRepository = new InMemoryLedgerReadRepository();
  const readService = new LedgerReadService(readRepository);

  return buildServer({
    ledgerService,
    readService,
    readinessCheck: async () => {},
    logger: false,
  });
};

const parsePayload = <T>(body: string): T => JSON.parse(body) as T;
const VALID_TENANT_ID = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_LEDGER_ID = '00000000-0000-4000-8000-999999999999';

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
    const repository = new InMemoryLedgerRepository();
    const ledgerService = new LedgerService(repository);
    const readRepository = new InMemoryLedgerReadRepository();
    const readService = new LedgerReadService(readRepository);
    const server = buildServer({
      ledgerService,
      readService,
      readinessCheck: async () => {
        throw new Error('db unavailable');
      },
      logger: false,
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
      payload: { tenant_id: '', name: '' },
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
    });

    expect(response.statusCode).toBe(404);
    expect(parsePayload<{ error: string; message: string }>(response.body)).toEqual({
      error: 'LEDGER_NOT_FOUND',
      message: `Ledger not found: ${UNKNOWN_LEDGER_ID}`,
    });

    await server.close();
  });

  it('GET /v1/ledgers validates tenant_id query', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ledgers',
    });

    expect(response.statusCode).toBe(400);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('INVALID_INPUT');

    await server.close();
  });

  it('POST /v1/ledgers maps repository failures to 500', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      payload: {
        tenant_id: VALID_TENANT_ID,
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
      payload: {
        tenant_id: VALID_TENANT_ID,
        name: 'Main ledger',
      },
    });

    expect(response.statusCode).toBe(201);

    const payload = parsePayload<Ledger>(response.body);

    expect(payload.tenantId).toBe(VALID_TENANT_ID);
    expect(payload.name).toBe('Main ledger');

    await server.close();
  });

  it('GET /v1/ledgers rejects invalid tenant_id format', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ledgers?tenant_id=invalid-tenant',
    });

    expect(response.statusCode).toBe(400);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('INVALID_INPUT');

    await server.close();
  });

  it('GET /v1/ledgers?tenant_id returns tenant ledgers', async () => {
    const server = createServer();

    await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      payload: {
        tenant_id: VALID_TENANT_ID,
        name: 'Main ledger',
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: `/v1/ledgers?tenant_id=${VALID_TENANT_ID}`,
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
      payload: {
        tenant_id: VALID_TENANT_ID,
        name: 'Main ledger',
      },
    });

    const created = parsePayload<Ledger>(createdResponse.body);

    const response = await server.inject({
      method: 'GET',
      url: `/v1/ledgers/${created.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(parsePayload<Ledger>(response.body)).toEqual(created);

    await server.close();
  });

  it('POST /v1/ledgers rejects additional properties', async () => {
    const repository = new InMemoryLedgerRepository();
    const ledgerService = new LedgerService(repository);
    const readRepository = new InMemoryLedgerReadRepository();
    const readService = new LedgerReadService(readRepository);
    const server = buildServer({
      ledgerService,
      readService,
      readinessCheck: async () => {},
      logger: false,
    });

    const response = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      payload: {
        tenant_id: VALID_TENANT_ID,
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
      url: `/v1/accounts?tenant_id=${VALID_TENANT_ID}`,
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<{
      data: Array<{ id: string; balance_minor: string }>;
      next_cursor: string | null;
    }>(response.body);
    expect(payload.data.length).toBe(1);
    expect(payload.data[0]?.id).toBe('00000000-0000-4000-8000-000000000101');
    expect(payload.data[0]?.balance_minor).toBe('100');
    expect(payload.next_cursor).toBe('next-accounts');

    await server.close();
  });

  it('GET /v1/transactions supports cursor pagination', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: `/v1/transactions?tenant_id=${VALID_TENANT_ID}&cursor=next-transactions&limit=1`,
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
      url: `/v1/entries?tenant_id=${VALID_TENANT_ID}&cursor=next-entries&limit=1`,
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

  it('GET /v1/accounts validates limit upper bound', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: `/v1/accounts?tenant_id=${VALID_TENANT_ID}&limit=201`,
    });

    expect(response.statusCode).toBe(400);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('INVALID_INPUT');

    await server.close();
  });

  it('GET /v1/accounts requires tenant_id', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/accounts',
    });

    expect(response.statusCode).toBe(400);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload.error).toBe('INVALID_INPUT');

    await server.close();
  });

  it('GET /v1/ledgers/:ledger_id/trial-balance returns trial balance with string amounts', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ledgers/00000000-0000-4000-8000-000000000001/trial-balance',
    });

    expect(response.statusCode).toBe(200);
    const payload = parsePayload<{
      ledger_id: string;
      accounts: Array<{
        account_id: string;
        code: string;
        name: string;
        normal_balance: 'DEBIT' | 'CREDIT';
        balance: string;
      }>;
      total_debits: string;
      total_credits: string;
    }>(response.body);

    expect(payload.ledger_id).toBe('00000000-0000-4000-8000-000000000001');
    expect(payload.accounts.length).toBe(2);
    expect(payload.accounts[0]?.balance).toBe('100');
    expect(payload.total_debits).toBe('100');
    expect(payload.total_credits).toBe('100');

    await server.close();
  });

  it('GET /v1/ledgers/:ledger_id/trial-balance validates ledger_id format', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ledgers/not-a-uuid/trial-balance',
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
    });

    expect(response.statusCode).toBe(404);
    const payload = parsePayload<{ error: string; message: string }>(response.body);
    expect(payload).toEqual({
      error: 'LEDGER_NOT_FOUND',
      message: `Ledger not found: ${UNKNOWN_LEDGER_ID}`,
    });

    await server.close();
  });
});

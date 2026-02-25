import { describe, expect, it } from 'bun:test';

import { buildServer } from '@api/server';
import { RepositoryError } from '@core/errors';
import { LedgerService } from '@core/ledger-service';
import type {
  CreateLedgerInput,
  Ledger,
  LedgerRepository,
  PostTransactionInput,
  PostTransactionResult,
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

const createServer = () => {
  const repository = new InMemoryLedgerRepository();
  const ledgerService = new LedgerService(repository);

  return buildServer({
    ledgerService,
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

  it('POST /v1/ledgers validates input', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/v1/ledgers',
      payload: { tenant_id: '', name: '' },
    });

    expect(response.statusCode).toBe(400);
    const payload = parsePayload<{ code: string }>(response.body);
    expect(payload.code).toBe('FST_ERR_VALIDATION');

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
    const payload = parsePayload<{ code: string }>(response.body);
    expect(payload.code).toBe('FST_ERR_VALIDATION');

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
    const payload = parsePayload<{ code: string }>(response.body);
    expect(payload.code).toBe('FST_ERR_VALIDATION');

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
    const server = buildServer({
      ledgerService,
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
    const payload = parsePayload<{ code: string }>(response.body);
    expect(payload.code).toBe('FST_ERR_VALIDATION');

    await server.close();
  });

  it('GET /v1/ledgers/:id validates uuid format', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ledgers/not-a-uuid',
    });

    expect(response.statusCode).toBe(400);
    const payload = parsePayload<{ code: string }>(response.body);
    expect(payload.code).toBe('FST_ERR_VALIDATION');

    await server.close();
  });
});

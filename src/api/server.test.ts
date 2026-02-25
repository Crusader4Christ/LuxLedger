import { describe, expect, it } from 'bun:test';

import { buildServer } from '@api/server';
import { RepositoryError } from '@core/errors';
import { LedgerService } from '@core/ledger-service';
import type { CreateLedgerInput, Ledger, LedgerRepository } from '@core/types';

class InMemoryLedgerRepository implements LedgerRepository {
  private readonly ledgers = new Map<string, Ledger>();

  public async createLedger(input: CreateLedgerInput): Promise<Ledger> {
    if (input.name === 'force-db-error') {
      throw new RepositoryError('forced repository error');
    }

    const now = new Date();
    const id = `ledger-${this.ledgers.size + 1}`;
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

  it('POST /ledgers validates input', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/ledgers',
      payload: { tenant_id: '', name: '' },
    });

    expect(response.statusCode).toBe(400);
    expect(parsePayload<{ error: string; message: string }>(response.body)).toEqual({
      error: 'INVALID_INPUT',
      message: 'tenant_id and name are required',
    });

    await server.close();
  });

  it('GET /ledgers/:id maps LedgerNotFoundError to 404', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/ledgers/missing-id',
    });

    expect(response.statusCode).toBe(404);
    expect(parsePayload<{ error: string; message: string }>(response.body)).toEqual({
      error: 'LEDGER_NOT_FOUND',
      message: 'Ledger not found: missing-id',
    });

    await server.close();
  });

  it('GET /ledgers validates tenant_id query', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/ledgers',
    });

    expect(response.statusCode).toBe(400);
    expect(parsePayload<{ error: string; message: string }>(response.body)).toEqual({
      error: 'INVALID_INPUT',
      message: 'tenant_id is required',
    });

    await server.close();
  });

  it('POST /ledgers maps repository failures to 500', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/ledgers',
      payload: {
        tenant_id: 'tenant-1',
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

  it('POST /ledgers creates ledger through LedgerService', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'POST',
      url: '/ledgers',
      payload: {
        tenant_id: 'tenant-1',
        name: 'Main ledger',
      },
    });

    expect(response.statusCode).toBe(201);

    const payload = parsePayload<Ledger>(response.body);

    expect(payload.tenantId).toBe('tenant-1');
    expect(payload.name).toBe('Main ledger');

    await server.close();
  });

  it('GET /ledgers maps invariant violations to 400', async () => {
    const server = createServer();

    const response = await server.inject({
      method: 'GET',
      url: '/ledgers?tenant_id=   ',
    });

    expect(response.statusCode).toBe(400);
    expect(parsePayload<{ error: string; message: string }>(response.body)).toEqual({
      error: 'INVALID_INPUT',
      message: 'tenant_id is required',
    });

    await server.close();
  });

  it('GET /ledgers?tenant_id returns tenant ledgers', async () => {
    const server = createServer();

    await server.inject({
      method: 'POST',
      url: '/ledgers',
      payload: {
        tenant_id: 'tenant-1',
        name: 'Main ledger',
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/ledgers?tenant_id=tenant-1',
    });

    expect(response.statusCode).toBe(200);

    const payload = parsePayload<Ledger[]>(response.body);

    expect(payload.length).toBe(1);
    expect(payload[0]?.name).toBe('Main ledger');

    await server.close();
  });

  it('GET /ledgers/:id returns ledger when found', async () => {
    const server = createServer();

    const createdResponse = await server.inject({
      method: 'POST',
      url: '/ledgers',
      payload: {
        tenant_id: 'tenant-1',
        name: 'Main ledger',
      },
    });

    const created = parsePayload<Ledger>(createdResponse.body);

    const response = await server.inject({
      method: 'GET',
      url: `/ledgers/${created.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(parsePayload<Ledger>(response.body)).toEqual(created);

    await server.close();
  });

  it('POST /ledgers maps service invariant violations to 400', async () => {
    const repository = new InMemoryLedgerRepository();
    const ledgerService = new LedgerService(repository);
    const server = buildServer({
      ledgerService,
      logger: false,
    });

    const response = await server.inject({
      method: 'POST',
      url: '/ledgers',
      payload: {
        tenant_id: 'tenant-1',
        name: '   ',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(parsePayload<{ error: string; message: string }>(response.body)).toEqual({
      error: 'INVALID_INPUT',
      message: 'tenant_id and name are required',
    });

    await server.close();
  });
});

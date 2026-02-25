import { describe, expect, it } from 'bun:test';

import { InvariantViolationError, LedgerNotFoundError } from '@core/errors';
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

  public async postTransaction(_: PostTransactionInput): Promise<PostTransactionResult> {
    throw new Error('postTransaction is not used in LedgerService tests');
  }
}

describe('LedgerService', () => {
  it('createLedger returns entity', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    const ledger = await service.createLedger({
      tenantId: 'tenant-1',
      name: 'Cash',
    });

    expect(ledger.id).toBe('ledger-1');
    expect(ledger.tenantId).toBe('tenant-1');
    expect(ledger.name).toBe('Cash');
  });

  it('createLedger throws InvariantViolationError for empty tenantId', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    await expect(service.createLedger({ tenantId: '  ', name: 'Cash' })).rejects.toBeInstanceOf(
      InvariantViolationError,
    );
  });

  it('getLedgerById returns correct ledger', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    const created = await service.createLedger({
      tenantId: 'tenant-1',
      name: 'Cash',
    });

    const found = await service.getLedgerById(created.id);

    expect(found.id).toBe(created.id);
    expect(found.tenantId).toBe('tenant-1');
  });

  it('getLedgerById throws LedgerNotFoundError if not found', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    await expect(service.getLedgerById('missing-ledger')).rejects.toBeInstanceOf(
      LedgerNotFoundError,
    );
  });

  it('getLedgersByTenant throws InvariantViolationError for empty tenantId', async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);

    await expect(service.getLedgersByTenant('')).rejects.toBeInstanceOf(InvariantViolationError);
  });
});

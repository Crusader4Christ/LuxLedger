import { InvariantViolationError, LedgerNotFoundError } from '@core/errors';
import type { CreateLedgerInput, Ledger, LedgerRepository } from '@core/types';

export class LedgerService {
  private readonly repository: LedgerRepository;

  public constructor(repository: LedgerRepository) {
    this.repository = repository;
  }

  public async createLedger(input: CreateLedgerInput): Promise<Ledger> {
    this.assertNonEmpty(input.tenantId, 'tenantId is required');
    this.assertNonEmpty(input.name, 'name is required');

    return this.repository.createLedger({
      tenantId: input.tenantId,
      name: input.name,
    });
  }

  public async getLedgerById(id: string): Promise<Ledger> {
    this.assertNonEmpty(id, 'ledger id is required');

    const ledger = await this.repository.findLedgerById(id);

    if (!ledger) {
      throw new LedgerNotFoundError(id);
    }

    return ledger;
  }

  public async getLedgersByTenant(tenantId: string): Promise<Ledger[]> {
    this.assertNonEmpty(tenantId, 'tenantId is required');

    return this.repository.findLedgersByTenant(tenantId);
  }

  private assertNonEmpty(value: string, message: string): void {
    if (value.trim().length === 0) {
      throw new InvariantViolationError(message);
    }
  }
}

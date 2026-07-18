import { assertNonEmpty } from '../../utils';
import { LedgerNotFoundError } from '../errors';
import type { LedgerRepository } from '../repositories.interface';
import type { CreateLedgerInput, Ledger } from '../types';

export class LedgerService {
  public constructor(private readonly repository: LedgerRepository) {}

  public async create(input: CreateLedgerInput): Promise<Ledger> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    assertNonEmpty(input.name, 'name is required');
    return this.repository.create(input);
  }

  public async getById(tenantId: string, id: string): Promise<Ledger> {
    assertNonEmpty(tenantId, 'tenantId is required');
    assertNonEmpty(id, 'ledger id is required');
    const ledger = await this.repository.findById(tenantId, id);
    if (!ledger) {
      throw new LedgerNotFoundError(id);
    }
    return ledger;
  }

  public async list(tenantId: string): Promise<Ledger[]> {
    assertNonEmpty(tenantId, 'tenantId is required');
    return this.repository.list(tenantId);
  }
}

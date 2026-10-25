import { ledgerListFilter } from '../../ledger/list-filter';
import { assertNonEmpty } from '../../utils';
import { LedgerNotFoundError } from '../errors';
import { validateListWhere } from '../list-filters';
import { validatePaginationQuery } from '../pagination-query';
import type { LedgerRepository } from '../repositories.interface';
import type { CreateLedgerInput, Ledger, PaginatedResult, PaginationQuery } from '../types';

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

  public async list(
    query: PaginationQuery<typeof ledgerListFilter>,
  ): Promise<PaginatedResult<Ledger>> {
    validatePaginationQuery(query);
    validateListWhere(ledgerListFilter, query.where);
    return this.repository.list(query);
  }
}

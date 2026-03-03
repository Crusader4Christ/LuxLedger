import type { LedgerEntity } from './entity';
import type { CreateLedgerInput } from './input.interface';

export interface LedgerRepository {
  createLedger(input: CreateLedgerInput): Promise<LedgerEntity>;
  findLedgerByIdForTenant(tenantId: string, ledgerId: string): Promise<LedgerEntity | null>;
  findLedgersByTenant(tenantId: string): Promise<LedgerEntity[]>;
}

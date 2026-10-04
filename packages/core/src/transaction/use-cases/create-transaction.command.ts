import type { TransactionEntryInput } from '../../entry/input.interface';
import type { TransactionMetadata } from '../metadata';

export interface CreateTransactionCommand {
  tenantId: string;
  id: string;
  ledgerId: string;
  reference: string;
  currency: string;
  assetId?: string | null;
  description?: string | null;
  effectiveAt?: Date | null;
  metadata?: TransactionMetadata;
  entries: TransactionEntryInput[];
}

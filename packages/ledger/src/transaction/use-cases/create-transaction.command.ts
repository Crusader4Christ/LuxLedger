import type { TransactionEntryInput } from '../../entry/input.interface';

export interface CreateTransactionCommand {
  tenantId: string;
  id: string;
  ledgerId: string;
  reference: string;
  currency: string;
  entries: TransactionEntryInput[];
}

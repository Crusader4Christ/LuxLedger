import type { EntryDirection } from './entity';

export interface TransactionEntryInput {
  accountId: string;
  direction: EntryDirection;
  amountMinor: bigint;
  currency: string;
  assetId?: string | null;
}

export interface CreateEntryInput extends TransactionEntryInput {
  transactionId: string;
}

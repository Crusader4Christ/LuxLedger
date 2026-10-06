export interface TransactionEntryInput {
  accountId: string;
  signedAmountMinor: bigint;
  currency: string;
  assetId?: string | null;
}

export interface CreateEntryInput extends TransactionEntryInput {
  transactionId: string;
}

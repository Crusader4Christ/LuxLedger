import { EntryDirection } from '@luxledger/core';
import {
  InvariantViolationError,
  OverdraftPolicyViolationError,
} from '@luxledger/core/application';

type BalanceEntry = {
  accountId: string;
  direction: string;
  amountMinor: bigint;
};

export const aggregateAccountEntries = (entries: BalanceEntry[]) => {
  const byAccount = new Map<
    string,
    { accountId: string; debitMinor: bigint; creditMinor: bigint }
  >();
  for (const entry of entries) {
    const total = byAccount.get(entry.accountId) ?? {
      accountId: entry.accountId,
      debitMinor: 0n,
      creditMinor: 0n,
    };
    if (entry.direction === EntryDirection.DEBIT) {
      total.debitMinor += entry.amountMinor;
    } else if (entry.direction === EntryDirection.CREDIT) {
      total.creditMinor += entry.amountMinor;
    } else {
      throw new InvariantViolationError(`Unsupported entry direction: ${entry.direction}`);
    }
    byAccount.set(entry.accountId, total);
  }
  return [...byAccount.values()].sort((a, b) => a.accountId.localeCompare(b.accountId));
};

export const assertAvailableBalance = (account: {
  id: string;
  overdraftPolicy: 'ALLOW' | 'DISALLOW';
  balanceMinor: bigint;
  inflightDebitMinor: bigint;
  inflightCreditMinor: bigint;
}): void => {
  // Persisted balances use CREDIT minus DEBIT for either account side. A hold
  // reserves the same signed delta until its own commit converts it to posted.
  const availableMinor =
    account.balanceMinor - account.inflightDebitMinor + account.inflightCreditMinor;
  if (account.overdraftPolicy === 'DISALLOW' && availableMinor < 0n) {
    throw new OverdraftPolicyViolationError(account.id, availableMinor);
  }
};

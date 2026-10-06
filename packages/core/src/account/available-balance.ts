import { AccountId } from '../base/id';
import { validateSignedEntryAmount } from '../entry/validators';
import type { AccountSide } from './entity';

type BalanceEntry = {
  accountId: string;
  signedAmountMinor: bigint;
};

export const aggregateAccountEntries = (entries: readonly BalanceEntry[]) => {
  const byAccount = new Map<
    string,
    {
      accountId: string;
      signedAmountMinor: bigint;
      debitMinor: bigint;
      creditMinor: bigint;
    }
  >();
  for (const entry of entries) {
    new AccountId(entry.accountId);
    validateSignedEntryAmount(entry.signedAmountMinor);
    const total = byAccount.get(entry.accountId) ?? {
      accountId: entry.accountId,
      signedAmountMinor: 0n,
      debitMinor: 0n,
      creditMinor: 0n,
    };
    total.signedAmountMinor += entry.signedAmountMinor;
    if (entry.signedAmountMinor > 0n) {
      total.debitMinor += entry.signedAmountMinor;
    } else {
      total.creditMinor -= entry.signedAmountMinor;
    }
    byAccount.set(entry.accountId, total);
  }
  return [...byAccount.values()].sort((a, b) => a.accountId.localeCompare(b.accountId));
};

export const calculateAvailableMinor = (balance: {
  side: AccountSide;
  balanceMinor: bigint;
  inflightDebitMinor: bigint;
  inflightCreditMinor: bigint;
}): bigint => {
  const signedAvailableMinor =
    balance.balanceMinor + balance.inflightDebitMinor - balance.inflightCreditMinor;
  return balance.side === 'DEBIT' ? signedAvailableMinor : -signedAvailableMinor;
};

import { AccountId } from '../base/id';
import { EntryDirection } from '../entry/entity';
import { validateEntryAmount, validateEntryDirection } from '../entry/validators';

type BalanceEntry = {
  accountId: string;
  direction: EntryDirection;
  amountMinor: bigint;
};

export const aggregateAccountEntries = (entries: readonly BalanceEntry[]) => {
  const byAccount = new Map<
    string,
    { accountId: string; debitMinor: bigint; creditMinor: bigint }
  >();
  for (const entry of entries) {
    new AccountId(entry.accountId);
    validateEntryDirection(entry.direction);
    validateEntryAmount(entry.amountMinor);
    const total = byAccount.get(entry.accountId) ?? {
      accountId: entry.accountId,
      debitMinor: 0n,
      creditMinor: 0n,
    };
    if (entry.direction === EntryDirection.DEBIT) {
      total.debitMinor += entry.amountMinor;
    } else {
      total.creditMinor += entry.amountMinor;
    }
    byAccount.set(entry.accountId, total);
  }
  return [...byAccount.values()].sort((a, b) => a.accountId.localeCompare(b.accountId));
};

export const calculateAvailableMinor = (balance: {
  balanceMinor: bigint;
  inflightDebitMinor: bigint;
  inflightCreditMinor: bigint;
}): bigint => balance.balanceMinor - balance.inflightDebitMinor + balance.inflightCreditMinor;

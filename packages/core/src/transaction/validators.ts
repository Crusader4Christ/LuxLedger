import { isNonEmptyString } from '../base/string';
import {
  CurrencyMismatchError,
  InvalidAmountError,
  MissingReferenceError,
  NotEnoughEntriesError,
  UnbalancedTransactionError,
} from './errors';

type EntryAmountLine = {
  money: {
    amountMinor: bigint;
  };
};

type DoubleEntryLine = EntryAmountLine & {
  signedAmountMinor(): bigint;
};

type EntryCurrencyLine = {
  money: {
    currency: string;
  };
};

export function validateReference(reference: string): void {
  if (!isNonEmptyString(reference)) {
    throw new MissingReferenceError();
  }
}

export function validateEntryCurrencies(
  entries: readonly EntryCurrencyLine[],
  transactionCurrency: string,
): void {
  if (entries.some((entry) => entry.money.currency !== transactionCurrency)) {
    throw new CurrencyMismatchError();
  }
}

export function validateEntryAmounts(entries: readonly EntryAmountLine[]): void {
  for (const entry of entries) {
    if (entry.money.amountMinor <= 0n) {
      throw new InvalidAmountError('amount must be positive');
    }
  }
}

export function validateDoubleEntry(entries: readonly DoubleEntryLine[]): void {
  if (entries.length < 2) {
    throw new NotEnoughEntriesError();
  }

  const total = entries.reduce((sum, entry) => sum + entry.signedAmountMinor(), 0n);

  if (total !== 0n) {
    throw new UnbalancedTransactionError();
  }
}

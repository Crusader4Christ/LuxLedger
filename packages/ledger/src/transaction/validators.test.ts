import { describe, expect, it } from 'bun:test';

import {
  CurrencyMismatchError,
  InvalidAmountError,
  MissingReferenceError,
  NotEnoughEntriesError,
  UnbalancedTransactionError,
} from './errors';
import {
  validateDoubleEntry,
  validateEntryAmounts,
  validateEntryCurrencies,
  validateReference,
} from './validators';

describe('validateReference', () => {
  it('accepts non-empty reference', () => {
    expect(() => validateReference('ref-1')).not.toThrow();
  });

  it('rejects blank reference', () => {
    expect(() => validateReference('   ')).toThrowError(MissingReferenceError);
  });
});

describe('validateEntryCurrencies', () => {
  it('accepts entries with same transaction currency', () => {
    expect(() =>
      validateEntryCurrencies(
        [{ money: { currency: 'USD' } }, { money: { currency: 'USD' } }],
        'USD',
      ),
    ).not.toThrow();
  });

  it('rejects mismatched currency', () => {
    expect(() =>
      validateEntryCurrencies(
        [{ money: { currency: 'USD' } }, { money: { currency: 'EUR' } }],
        'USD',
      ),
    ).toThrowError(CurrencyMismatchError);
  });
});

describe('validateEntryAmounts', () => {
  it('accepts positive amounts', () => {
    expect(() =>
      validateEntryAmounts([
        { money: { amountMinor: 100n } },
        { money: { amountMinor: 1n } },
      ]),
    ).not.toThrow();
  });

  it('rejects zero amount', () => {
    expect(() => validateEntryAmounts([{ money: { amountMinor: 0n } }])).toThrowError(
      InvalidAmountError,
    );
  });

  it('rejects negative amount', () => {
    expect(() => validateEntryAmounts([{ money: { amountMinor: -1n } }])).toThrowError(
      InvalidAmountError,
    );
  });
});

describe('validateDoubleEntry', () => {
  it('accepts balanced entries', () => {
    expect(() =>
      validateDoubleEntry([
        { money: { amountMinor: 100n }, signedAmountMinor: () => -100n },
        { money: { amountMinor: 100n }, signedAmountMinor: () => 100n },
      ]),
    ).not.toThrow();
  });

  it('rejects less than two entries', () => {
    expect(() =>
      validateDoubleEntry([{ money: { amountMinor: 100n }, signedAmountMinor: () => -100n }]),
    ).toThrowError(NotEnoughEntriesError);
  });

  it('rejects unbalanced entries', () => {
    expect(() =>
      validateDoubleEntry([
        { money: { amountMinor: 100n }, signedAmountMinor: () => -100n },
        { money: { amountMinor: 99n }, signedAmountMinor: () => 99n },
      ]),
    ).toThrowError(UnbalancedTransactionError);
  });
});

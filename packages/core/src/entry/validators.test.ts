import { describe, expect, it } from 'bun:test';

import { InvalidAmountError } from '../transaction/errors';
import { validateSignedEntryAmount } from './validators';

describe('validateSignedEntryAmount', () => {
  it('accepts positive debit and negative credit amounts', () => {
    expect(() => validateSignedEntryAmount(1n)).not.toThrow();
    expect(() => validateSignedEntryAmount(-1n)).not.toThrow();
  });

  it('rejects zero amount', () => {
    expect(() => validateSignedEntryAmount(0n)).toThrowError(InvalidAmountError);
  });
});

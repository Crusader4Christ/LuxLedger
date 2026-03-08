import { describe, expect, it } from 'bun:test';

import { InvalidAmountError, InvalidDirectionError } from '../transaction/errors';
import { validateEntryAmount, validateEntryDirection } from './validators';

describe('validateEntryDirection', () => {
  it('accepts DEBIT and CREDIT', () => {
    expect(() => validateEntryDirection('DEBIT')).not.toThrow();
    expect(() => validateEntryDirection('CREDIT')).not.toThrow();
  });

  it('rejects unsupported direction', () => {
    expect(() => validateEntryDirection('INVALID')).toThrowError(InvalidDirectionError);
  });
});

describe('validateEntryAmount', () => {
  it('accepts positive amount', () => {
    expect(() => validateEntryAmount(1n)).not.toThrow();
  });

  it('rejects zero amount', () => {
    expect(() => validateEntryAmount(0n)).toThrowError(InvalidAmountError);
  });

  it('rejects negative amount', () => {
    expect(() => validateEntryAmount(-1n)).toThrowError(InvalidAmountError);
  });
});

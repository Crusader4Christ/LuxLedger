import { describe, expect, it } from 'bun:test';

import { parseIntegerWithinRange } from './parse-integer-with-range';

describe('parseIntegerWithinRange', () => {
  it('returns default when value is undefined', () => {
    expect(
      parseIntegerWithinRange(undefined, {
        defaultValue: 7,
        errorMessage: 'invalid',
      }),
    ).toBe(7);
  });

  it('supports min-only validation', () => {
    expect(
      parseIntegerWithinRange('3', {
        defaultValue: 1,
        min: 1,
        errorMessage: 'invalid',
      }),
    ).toBe(3);

    expect(() =>
      parseIntegerWithinRange('0', {
        defaultValue: 1,
        min: 1,
        errorMessage: 'invalid',
      }),
    ).toThrow('invalid');
  });

  it('supports max-only validation', () => {
    expect(
      parseIntegerWithinRange('3', {
        defaultValue: 1,
        max: 5,
        errorMessage: 'invalid',
      }),
    ).toBe(3);

    expect(() =>
      parseIntegerWithinRange('6', {
        defaultValue: 1,
        max: 5,
        errorMessage: 'invalid',
      }),
    ).toThrow('invalid');
  });
});

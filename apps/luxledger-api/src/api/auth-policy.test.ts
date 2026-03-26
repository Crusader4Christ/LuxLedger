import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_JWT_ACCESS_TTL_SECONDS,
  MAX_JWT_ACCESS_TTL_SECONDS,
  MIN_JWT_ACCESS_TTL_SECONDS,
  parseJwtAccessTtlSeconds,
} from '@api/auth-policy';

describe('auth policy', () => {
  it('uses the documented default TTL', () => {
    expect(parseJwtAccessTtlSeconds(undefined)).toBe(DEFAULT_JWT_ACCESS_TTL_SECONDS);
  });

  it('accepts TTL values inside the allowed short-lived window', () => {
    expect(parseJwtAccessTtlSeconds(String(MIN_JWT_ACCESS_TTL_SECONDS))).toBe(
      MIN_JWT_ACCESS_TTL_SECONDS,
    );
    expect(parseJwtAccessTtlSeconds(String(MAX_JWT_ACCESS_TTL_SECONDS))).toBe(
      MAX_JWT_ACCESS_TTL_SECONDS,
    );
  });

  it('rejects TTL values outside the allowed short-lived window', () => {
    expect(() => parseJwtAccessTtlSeconds(String(MIN_JWT_ACCESS_TTL_SECONDS - 1))).toThrow(
      'JWT_ACCESS_TTL_SECONDS must be an integer between 300 and 900',
    );
    expect(() => parseJwtAccessTtlSeconds(String(MAX_JWT_ACCESS_TTL_SECONDS + 1))).toThrow(
      'JWT_ACCESS_TTL_SECONDS must be an integer between 300 and 900',
    );
  });
});

import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_JWT_CLOCK_SKEW_SECONDS,
  DEFAULT_JWT_ACCESS_TTL_SECONDS,
  DEFAULT_JWT_ISSUER,
  MAX_JWT_ACCESS_TTL_SECONDS,
  MAX_JWT_CLOCK_SKEW_SECONDS,
  MIN_JWT_ACCESS_TTL_SECONDS,
  parseJwtAuthConfig,
  parseJwtAccessTtlSeconds,
  parseJwtClockSkewSeconds,
} from '@api/auth-policy';

describe('auth policy', () => {
  const JWT_SIGNING_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY';
  const PREVIOUS_JWT_SIGNING_KEY = 'YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODk';

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

  it('uses the documented default clock skew', () => {
    expect(parseJwtClockSkewSeconds(undefined)).toBe(DEFAULT_JWT_CLOCK_SKEW_SECONDS);
  });

  it('rejects clock skew values outside the allowed range', () => {
    expect(() => parseJwtClockSkewSeconds('-1')).toThrow(
      `JWT_CLOCK_SKEW_SECONDS must be an integer between 0 and ${MAX_JWT_CLOCK_SKEW_SECONDS}`,
    );
    expect(() => parseJwtClockSkewSeconds(String(MAX_JWT_CLOCK_SKEW_SECONDS + 1))).toThrow(
      `JWT_CLOCK_SKEW_SECONDS must be an integer between 0 and ${MAX_JWT_CLOCK_SKEW_SECONDS}`,
    );
  });

  it('parses JWT auth config with previous verification keys', () => {
    expect(
      parseJwtAuthConfig({
        JWT_SIGNING_KEY,
        JWT_PREVIOUS_SIGNING_KEYS: PREVIOUS_JWT_SIGNING_KEY,
      }),
    ).toEqual({
      signingKey: JWT_SIGNING_KEY,
      previousSigningKeys: [PREVIOUS_JWT_SIGNING_KEY],
      issuer: DEFAULT_JWT_ISSUER,
      accessTokenTtlSeconds: DEFAULT_JWT_ACCESS_TTL_SECONDS,
      clockSkewSeconds: DEFAULT_JWT_CLOCK_SKEW_SECONDS,
    });
  });

  it('fails startup when JWT_SIGNING_KEY is missing or weak', () => {
    expect(() => parseJwtAuthConfig({})).toThrow('JWT_SIGNING_KEY is required');
    expect(() => parseJwtAuthConfig({ JWT_SIGNING_KEY: 'short' })).toThrow(
      'JWT_SIGNING_KEY must be an unpadded base64url string representing at least 32 random bytes',
    );
  });
});

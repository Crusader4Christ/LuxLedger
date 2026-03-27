import { describe, expect, it } from 'bun:test';

import type { JwtAuthConfig } from '@api/jwt-auth';
import { issueAccessToken, verifyAccessToken } from '@api/jwt-auth';
import { ApiKeyRole } from '@lux/ledger';

const JWT_SIGNING_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY';
const JWT_ISSUER = 'luxledger-api-test';

const AUTH_CONTEXT = {
  apiKeyId: '00000000-0000-4000-8000-000000000901',
  tenantId: '11111111-1111-4111-8111-111111111111',
  role: ApiKeyRole.ADMIN,
} as const;

const createJwtAuthConfig = (overrides: Partial<JwtAuthConfig> = {}): JwtAuthConfig => ({
  signingKey: JWT_SIGNING_KEY,
  previousSigningKeys: [],
  issuer: JWT_ISSUER,
  accessTokenTtlSeconds: 900,
  clockSkewSeconds: 5,
  ...overrides,
});

describe('jwt auth', () => {
  it('verifies token signed with the current signing key', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const config = createJwtAuthConfig();

    const token = issueAccessToken(AUTH_CONTEXT, config, now);

    expect(verifyAccessToken(token, config, now)).toEqual(AUTH_CONTEXT);
  });

  it('applies the configured clock skew when checking token expiry', () => {
    const issuedAt = new Date('2026-01-01T00:00:00.000Z');
    const config = createJwtAuthConfig({
      accessTokenTtlSeconds: 300,
      clockSkewSeconds: 5,
    });
    const token = issueAccessToken(AUTH_CONTEXT, config, issuedAt);

    expect(verifyAccessToken(token, config, new Date('2026-01-01T00:05:04.000Z'))).toEqual(
      AUTH_CONTEXT,
    );
    expect(() => verifyAccessToken(token, config, new Date('2026-01-01T00:05:05.000Z'))).toThrow(
      'Access token expired',
    );
  });
});

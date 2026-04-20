import type { JwtAuthConfig } from './jwt';
import { parseIntegerWithinRange } from '../../utils/parse-integer-with-range';

export const MIN_JWT_SIGNING_KEY_BYTES = 32;
export const DEFAULT_JWT_ISSUER = 'luxledger-api';
export const DEFAULT_JWT_CLOCK_SKEW_SECONDS = 5;
export const MAX_JWT_CLOCK_SKEW_SECONDS = 60;
export const MIN_JWT_ACCESS_TTL_SECONDS = 300;
export const MAX_JWT_ACCESS_TTL_SECONDS = 900;

// Keep the default at the top of the short-lived window because every bearer-authenticated
// request revalidates the backing API key, so revocation remains immediate without extra churn.
export const DEFAULT_JWT_ACCESS_TTL_SECONDS = MAX_JWT_ACCESS_TTL_SECONDS;

const JWT_SIGNING_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

const requireNonEmptyEnv = (value: string | undefined, name: string): string => {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value.trim();
};

const parseJwtSigningKey = (value: string, name: string): string => {
  if (!JWT_SIGNING_KEY_PATTERN.test(value)) {
    throw new Error(
      `${name} must be an unpadded base64url string representing at least ${MIN_JWT_SIGNING_KEY_BYTES} random bytes`,
    );
  }

  const decodedValue = Buffer.from(value, 'base64url');
  const normalizedValue = decodedValue.toString('base64url');

  if (normalizedValue !== value || decodedValue.length < MIN_JWT_SIGNING_KEY_BYTES) {
    throw new Error(
      `${name} must be an unpadded base64url string representing at least ${MIN_JWT_SIGNING_KEY_BYTES} random bytes`,
    );
  }

  return value;
};

const parseJwtPreviousSigningKeys = (
  value: string | undefined,
  signingKey: string,
): string[] => {
  if (value === undefined || value.trim().length === 0) {
    return [];
  }

  const keys = value.split(',').map((entry) => entry.trim());
  if (keys.some((entry) => entry.length === 0)) {
    throw new Error('JWT_PREVIOUS_SIGNING_KEYS must not contain empty entries');
  }

  const uniqueKeys = new Set<string>();

  for (const key of keys) {
    const parsedKey = parseJwtSigningKey(key, 'JWT_PREVIOUS_SIGNING_KEYS');

    if (parsedKey === signingKey) {
      throw new Error('JWT_PREVIOUS_SIGNING_KEYS must not include JWT_SIGNING_KEY');
    }

    if (uniqueKeys.has(parsedKey)) {
      throw new Error('JWT_PREVIOUS_SIGNING_KEYS must not contain duplicate keys');
    }

    uniqueKeys.add(parsedKey);
  }

  return [...uniqueKeys];
};

export const parseJwtAccessTtlSeconds = (value: string | undefined): number => {
  return parseIntegerWithinRange(value, {
    defaultValue: DEFAULT_JWT_ACCESS_TTL_SECONDS,
    min: MIN_JWT_ACCESS_TTL_SECONDS,
    max: MAX_JWT_ACCESS_TTL_SECONDS,
    errorMessage: `JWT_ACCESS_TTL_SECONDS must be an integer between ${MIN_JWT_ACCESS_TTL_SECONDS} and ${MAX_JWT_ACCESS_TTL_SECONDS}`,
  });
};

export const parseJwtClockSkewSeconds = (value: string | undefined): number => {
  return parseIntegerWithinRange(value, {
    defaultValue: DEFAULT_JWT_CLOCK_SKEW_SECONDS,
    min: 0,
    max: MAX_JWT_CLOCK_SKEW_SECONDS,
    errorMessage: `JWT_CLOCK_SKEW_SECONDS must be an integer between 0 and ${MAX_JWT_CLOCK_SKEW_SECONDS}`,
  });
};

export const parseJwtAuthConfig = (env: NodeJS.ProcessEnv): JwtAuthConfig => {
  const signingKey = parseJwtSigningKey(
    requireNonEmptyEnv(env.JWT_SIGNING_KEY, 'JWT_SIGNING_KEY'),
    'JWT_SIGNING_KEY',
  );
  const previousSigningKeys = parseJwtPreviousSigningKeys(
    env.JWT_PREVIOUS_SIGNING_KEYS,
    signingKey,
  );
  const issuer = env.JWT_ISSUER?.trim() || DEFAULT_JWT_ISSUER;

  return {
    signingKey,
    previousSigningKeys,
    issuer,
    accessTokenTtlSeconds: parseJwtAccessTtlSeconds(env.JWT_ACCESS_TTL_SECONDS),
    clockSkewSeconds: parseJwtClockSkewSeconds(env.JWT_CLOCK_SKEW_SECONDS),
  };
};

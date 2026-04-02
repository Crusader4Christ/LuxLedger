export interface EndpointRateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

export interface RateLimitConfig {
  authToken: EndpointRateLimitConfig;
  write: EndpointRateLimitConfig;
}

export const DEFAULT_AUTH_TOKEN_RATE_LIMIT_MAX_REQUESTS = 20;
export const DEFAULT_AUTH_TOKEN_RATE_LIMIT_WINDOW_SECONDS = 60;
export const DEFAULT_WRITE_RATE_LIMIT_MAX_REQUESTS = 120;
export const DEFAULT_WRITE_RATE_LIMIT_WINDOW_SECONDS = 60;

const parsePositiveInteger = (
  value: string | undefined,
  name: string,
  defaultValue: number,
): number => {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
};

export const parseRateLimitConfig = (env: NodeJS.ProcessEnv): RateLimitConfig => ({
  authToken: {
    maxRequests: parsePositiveInteger(
      env.RATE_LIMIT_AUTH_TOKEN_MAX_REQUESTS,
      'RATE_LIMIT_AUTH_TOKEN_MAX_REQUESTS',
      DEFAULT_AUTH_TOKEN_RATE_LIMIT_MAX_REQUESTS,
    ),
    windowSeconds: parsePositiveInteger(
      env.RATE_LIMIT_AUTH_TOKEN_WINDOW_SECONDS,
      'RATE_LIMIT_AUTH_TOKEN_WINDOW_SECONDS',
      DEFAULT_AUTH_TOKEN_RATE_LIMIT_WINDOW_SECONDS,
    ),
  },
  write: {
    maxRequests: parsePositiveInteger(
      env.RATE_LIMIT_WRITE_MAX_REQUESTS,
      'RATE_LIMIT_WRITE_MAX_REQUESTS',
      DEFAULT_WRITE_RATE_LIMIT_MAX_REQUESTS,
    ),
    windowSeconds: parsePositiveInteger(
      env.RATE_LIMIT_WRITE_WINDOW_SECONDS,
      'RATE_LIMIT_WRITE_WINDOW_SECONDS',
      DEFAULT_WRITE_RATE_LIMIT_WINDOW_SECONDS,
    ),
  },
});

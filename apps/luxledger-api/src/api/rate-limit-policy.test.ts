import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_AUTH_TOKEN_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_AUTH_TOKEN_RATE_LIMIT_WINDOW_SECONDS,
  DEFAULT_WRITE_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_WRITE_RATE_LIMIT_WINDOW_SECONDS,
  parseRateLimitConfig,
} from '@api/rate-limit-policy';

describe('rate limit policy', () => {
  it('uses documented defaults when env vars are not set', () => {
    expect(parseRateLimitConfig({})).toEqual({
      authToken: {
        maxRequests: DEFAULT_AUTH_TOKEN_RATE_LIMIT_MAX_REQUESTS,
        windowSeconds: DEFAULT_AUTH_TOKEN_RATE_LIMIT_WINDOW_SECONDS,
      },
      write: {
        maxRequests: DEFAULT_WRITE_RATE_LIMIT_MAX_REQUESTS,
        windowSeconds: DEFAULT_WRITE_RATE_LIMIT_WINDOW_SECONDS,
      },
    });
  });

  it('parses custom auth and write limits from env vars', () => {
    expect(
      parseRateLimitConfig({
        RATE_LIMIT_AUTH_TOKEN_MAX_REQUESTS: '7',
        RATE_LIMIT_AUTH_TOKEN_WINDOW_SECONDS: '120',
        RATE_LIMIT_WRITE_MAX_REQUESTS: '42',
        RATE_LIMIT_WRITE_WINDOW_SECONDS: '30',
      }),
    ).toEqual({
      authToken: {
        maxRequests: 7,
        windowSeconds: 120,
      },
      write: {
        maxRequests: 42,
        windowSeconds: 30,
      },
    });
  });

  it('fails startup when any rate-limit value is not a positive integer', () => {
    expect(() => parseRateLimitConfig({ RATE_LIMIT_AUTH_TOKEN_MAX_REQUESTS: '0' })).toThrow(
      'RATE_LIMIT_AUTH_TOKEN_MAX_REQUESTS must be a positive integer',
    );
    expect(() => parseRateLimitConfig({ RATE_LIMIT_AUTH_TOKEN_WINDOW_SECONDS: '-1' })).toThrow(
      'RATE_LIMIT_AUTH_TOKEN_WINDOW_SECONDS must be a positive integer',
    );
    expect(() => parseRateLimitConfig({ RATE_LIMIT_WRITE_MAX_REQUESTS: '1.5' })).toThrow(
      'RATE_LIMIT_WRITE_MAX_REQUESTS must be a positive integer',
    );
    expect(() => parseRateLimitConfig({ RATE_LIMIT_WRITE_WINDOW_SECONDS: 'abc' })).toThrow(
      'RATE_LIMIT_WRITE_WINDOW_SECONDS must be a positive integer',
    );
  });
});

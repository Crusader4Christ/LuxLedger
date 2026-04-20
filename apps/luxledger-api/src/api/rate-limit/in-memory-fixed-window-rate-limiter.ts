import type { EndpointRateLimitConfig } from '@api/rate-limit-policy';

interface FixedWindowBucket {
  windowStartMs: number;
  count: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class InMemoryFixedWindowRateLimiter {
  private readonly buckets = new Map<string, FixedWindowBucket>();

  public consume(
    key: string,
    policy: EndpointRateLimitConfig,
    nowMs = Date.now(),
  ): RateLimitDecision {
    const windowMs = policy.windowSeconds * 1000;
    const current = this.buckets.get(key);
    const activeBucket =
      current === undefined || nowMs >= current.windowStartMs + windowMs
        ? { windowStartMs: nowMs, count: 0 }
        : current;

    if (activeBucket.count >= policy.maxRequests) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((activeBucket.windowStartMs + windowMs - nowMs) / 1000),
      );

      return {
        allowed: false,
        retryAfterSeconds,
      };
    }

    activeBucket.count += 1;
    this.buckets.set(key, activeBucket);

    return {
      allowed: true,
      retryAfterSeconds: 0,
    };
  }
}

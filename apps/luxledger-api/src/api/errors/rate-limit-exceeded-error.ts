const RATE_LIMIT_EXCEEDED_ERROR_CODE = 'RATE_LIMIT_EXCEEDED';
const RATE_LIMIT_EXCEEDED_ERROR_MESSAGE = 'Rate limit exceeded';

export class RateLimitExceededError extends Error {
  public readonly code = RATE_LIMIT_EXCEEDED_ERROR_CODE;
  public readonly retryAfterSeconds: number;

  public constructor(retryAfterSeconds: number) {
    super(RATE_LIMIT_EXCEEDED_ERROR_MESSAGE);
    this.name = 'RateLimitExceededError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

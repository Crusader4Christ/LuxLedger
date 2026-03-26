export const MIN_JWT_ACCESS_TTL_SECONDS = 300;
export const MAX_JWT_ACCESS_TTL_SECONDS = 900;

// Keep the default at the top of the short-lived window because every bearer-authenticated
// request revalidates the backing API key, so revocation remains immediate without extra churn.
export const DEFAULT_JWT_ACCESS_TTL_SECONDS = MAX_JWT_ACCESS_TTL_SECONDS;

export const parseJwtAccessTtlSeconds = (value: string | undefined): number => {
  if (value === undefined) {
    return DEFAULT_JWT_ACCESS_TTL_SECONDS;
  }

  const ttl = Number(value);
  if (
    !Number.isInteger(ttl) ||
    ttl < MIN_JWT_ACCESS_TTL_SECONDS ||
    ttl > MAX_JWT_ACCESS_TTL_SECONDS
  ) {
    throw new Error(
      `JWT_ACCESS_TTL_SECONDS must be an integer between ${MIN_JWT_ACCESS_TTL_SECONDS} and ${MAX_JWT_ACCESS_TTL_SECONDS}`,
    );
  }

  return ttl;
};

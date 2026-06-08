export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isNonEmptyTrimmed = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

export const parseUuidParam = <T extends string>(
  value: unknown,
  key: T,
): Record<T, string> | null => {
  if (!isUuid(value)) {
    return null;
  }
  return { [key]: value } as Record<T, string>;
};

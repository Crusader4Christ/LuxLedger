import { isRecord } from '../validation-utils';

export const resolveLimit = (value: number | undefined): number => value ?? 50;

export const parseLimitQuery = (value: unknown): number | null => {
  if (value === undefined) {
    return 50;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 200) {
    return null;
  }
  return numeric;
};

export const parseCursorQuery = (value: unknown): string | null => {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return value;
};

export const parseUuidQuery = (value: unknown): string | null => {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(value) ? value : null;
};

export const deepMerge = (
  base: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...base };
  if (Object.entries(extra).length === 0) {
    return merged;
  }

  for (const [key, value] of Object.entries(extra)) {
    const existing = merged[key];
    if (isRecord(existing) && isRecord(value)) {
      merged[key] = deepMerge(existing, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
};

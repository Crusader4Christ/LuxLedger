import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../contracts/pagination';

export const resolveLimit = (value: number | undefined): number => value ?? DEFAULT_PAGE_LIMIT;

export const parseLimitQuery = (value: unknown): number | null => {
  if (value === undefined) {
    return DEFAULT_PAGE_LIMIT;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > MAX_PAGE_LIMIT) {
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

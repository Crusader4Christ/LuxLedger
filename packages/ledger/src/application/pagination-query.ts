import { assertNonEmpty } from '../utils';
import { InvariantViolationError } from './errors';
import type { PaginationQuery } from './types';

export const validatePaginationQuery = (query: PaginationQuery): void => {
  assertNonEmpty(query.tenantId, 'tenantId is required');

  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200) {
    throw new InvariantViolationError('limit must be an integer between 1 and 200');
  }

  if (query.cursor !== undefined && query.cursor.trim().length === 0) {
    throw new InvariantViolationError('cursor must be a non-empty string');
  }
};

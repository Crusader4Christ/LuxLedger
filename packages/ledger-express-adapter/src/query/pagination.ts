import { parseCursorQuery, parseLimitQuery } from '@lux/ledger-http/query/pagination';

export type ResolvedPaginationQuery = {
  limit: number;
  cursor?: string;
};

export const parsePaginationQuery = (
  query: Record<string, unknown>,
): ResolvedPaginationQuery | null => {
  const limit = parseLimitQuery(query.limit);
  const cursor = parseCursorQuery(query.cursor);
  if (limit === null || (query.cursor !== undefined && cursor === null)) {
    return null;
  }
  return {
    limit,
    cursor: cursor ?? undefined,
  };
};

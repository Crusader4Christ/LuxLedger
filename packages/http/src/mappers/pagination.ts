import type { PaginatedResult } from '@luxledger/core/application';

export const toPaginatedResponse = <Source, Target>(
  page: PaginatedResult<Source>,
  mapItem: (item: Source) => Target,
): { data: Target[]; next_cursor: string | null } => ({
  data: page.data.map(mapItem),
  next_cursor: page.nextCursor,
});

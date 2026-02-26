import type { PaginatedResult } from '@core/types';

export interface PageResponse<T> {
  data: T[];
  next_cursor: string | null;
}

export const toPageResponse = <Source, Target>(
  page: PaginatedResult<Source>,
  mapItem: (item: Source) => Target,
): PageResponse<Target> => ({
  data: page.data.map((item) => mapItem(item)),
  next_cursor: page.nextCursor,
});

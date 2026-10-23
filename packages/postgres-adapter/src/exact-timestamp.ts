import { type AnyColumn, type SQL, sql } from 'drizzle-orm';

/** Preserve PostgreSQL microseconds when constructing keyset cursors. */
export const exactTimestamp = (column: AnyColumn): SQL<string> =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

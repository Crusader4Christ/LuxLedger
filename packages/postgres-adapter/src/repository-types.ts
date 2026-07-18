export interface DatabaseErrorLike {
  code?: unknown;
  cause?: unknown;
}

export interface CursorPage<Row> {
  rows: Row[];
  nextCursor: string | null;
}

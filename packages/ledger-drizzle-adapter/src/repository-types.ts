export interface DatabaseErrorLike {
  code?: unknown;
  cause?: unknown;
}

export interface CursorValue {
  createdAt: Date;
  id: string;
}

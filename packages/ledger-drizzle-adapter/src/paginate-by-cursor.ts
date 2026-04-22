import { InvariantViolationError, type PaginationQuery } from '@lux/ledger/application';
import type { AnyColumn } from 'drizzle-orm';
import { and, asc, desc, eq, gt, lt, or, type SQL, type SQLWrapper, sql } from 'drizzle-orm';
import type { CursorPage } from './repository-types';

type CursorDirection = 'asc' | 'desc';
type CursorComparable = Date | number | string;
type CursorValueType = 'date' | 'number' | 'string';

interface CursorOrderField<Row> {
  column: AnyColumn;
  key: string;
  type: CursorValueType;
  direction?: CursorDirection;
  getValue: (row: Row) => CursorComparable;
}

interface PaginateByCursorOptions<Row> {
  query: PaginationQuery;
  order: [CursorOrderField<Row>, ...CursorOrderField<Row>[]];
  selectRows: (params: {
    cursorPredicate: SQL<unknown> | SQLWrapper;
    limit: number;
    orderBy: SQL[];
  }) => Promise<Row[]>;
}

const parseCursorValue = (raw: unknown, type: CursorValueType): CursorComparable => {
  if (type === 'string') {
    if (typeof raw !== 'string') {
      throw new InvariantViolationError('Invalid cursor');
    }

    return raw;
  }

  if (type === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new InvariantViolationError('Invalid cursor');
    }

    return raw;
  }

  if (typeof raw !== 'string') {
    throw new InvariantViolationError('Invalid cursor');
  }

  const value = new Date(raw);

  if (Number.isNaN(value.getTime())) {
    throw new InvariantViolationError('Invalid cursor');
  }

  return value;
};

const serializeCursorValue = (value: CursorComparable, type: CursorValueType): unknown => {
  if (type === 'string') {
    if (typeof value !== 'string') {
      throw new InvariantViolationError('Invalid cursor');
    }

    return value;
  }

  if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new InvariantViolationError('Invalid cursor');
    }

    return value;
  }

  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new InvariantViolationError('Invalid cursor');
  }

  return value.toISOString();
};

const parseCursor = <Row>(
  cursor: string | undefined,
  order: [CursorOrderField<Row>, ...CursorOrderField<Row>[]],
): Map<string, CursorComparable> | null => {
  if (!cursor) {
    return null;
  }

  let decoded: unknown;

  try {
    const text = Buffer.from(cursor, 'base64url').toString('utf8');
    decoded = JSON.parse(text);
  } catch {
    throw new InvariantViolationError('Invalid cursor');
  }

  if (typeof decoded !== 'object' || decoded === null) {
    throw new InvariantViolationError('Invalid cursor');
  }

  const payload = decoded as Record<string, unknown>;
  const cursorValues = new Map<string, CursorComparable>();

  for (const field of order) {
    if (!(field.key in payload)) {
      throw new InvariantViolationError('Invalid cursor');
    }

    cursorValues.set(field.key, parseCursorValue(payload[field.key], field.type));
  }

  return cursorValues;
};

const encodeCursor = <Row>(
  row: Row,
  order: [CursorOrderField<Row>, ...CursorOrderField<Row>[]],
): string => {
  const payload: Record<string, unknown> = {};

  for (const field of order) {
    payload[field.key] = serializeCursorValue(field.getValue(row), field.type);
  }

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
};

const buildCursorPredicate = <Row>(
  cursorValues: Map<string, CursorComparable> | null,
  order: [CursorOrderField<Row>, ...CursorOrderField<Row>[]],
): SQL<unknown> | SQLWrapper => {
  if (cursorValues === null) {
    return sql`true`;
  }

  let previousEquals: SQL<unknown> | undefined;
  const clauses: SQL<unknown>[] = [];

  for (const field of order) {
    const cursorValue = cursorValues.get(field.key);
    if (cursorValue === undefined) {
      throw new InvariantViolationError('Invalid cursor');
    }

    const direction: CursorDirection = field.direction ?? 'asc';
    const step =
      direction === 'desc' ? lt(field.column, cursorValue) : gt(field.column, cursorValue);
    const clause = previousEquals ? and(previousEquals, step) : step;

    if (clause) {
      clauses.push(clause);
    }

    const equals = eq(field.column, cursorValue);
    previousEquals = previousEquals ? (and(previousEquals, equals) ?? equals) : equals;
  }

  return clauses.length > 0 ? (or(...clauses) ?? sql`true`) : sql`true`;
};

const buildOrderBy = <Row>(order: [CursorOrderField<Row>, ...CursorOrderField<Row>[]]): SQL[] =>
  order.map((field) => {
    const direction: CursorDirection = field.direction ?? 'asc';
    return direction === 'desc' ? desc(field.column) : asc(field.column);
  });

export const paginateByCursor = async <Row>(
  options: PaginateByCursorOptions<Row>,
): Promise<CursorPage<Row>> => {
  const cursorValues = parseCursor(options.query.cursor, options.order);
  const cursorPredicate = buildCursorPredicate(cursorValues, options.order);
  const orderBy = buildOrderBy(options.order);
  const rows = await options.selectRows({
    cursorPredicate,
    limit: options.query.limit + 1,
    orderBy,
  });

  const hasNext = rows.length > options.query.limit;
  const pageRows = hasNext ? rows.slice(0, options.query.limit) : rows;
  const last = pageRows.at(-1);

  return {
    rows: pageRows,
    nextCursor: hasNext && last ? encodeCursor(last, options.order) : null,
  };
};

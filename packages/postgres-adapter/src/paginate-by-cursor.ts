import { createHash } from 'node:crypto';
import type { UnknownRecord } from '@luxledger/core';
import { type BasePaginationQuery, InvariantViolationError } from '@luxledger/core/application';
import type { AnyColumn } from 'drizzle-orm';
import { and, asc, desc, eq, gt, lt, or, SQL, type SQLWrapper, sql } from 'drizzle-orm';
import stringify from 'safe-stable-stringify';
import type { CursorPage } from './repository-types';

type CursorDirection = 'asc' | 'desc';
type CursorComparable = Date | number | string;
type CursorValueType = 'date' | 'number' | 'string' | 'timestamp' | 'uuid';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Accept existing millisecond cursors; new timestamp cursors retain six digits.
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(?:\d{3}|\d{6})Z$/;

interface CursorOrderField<Row> {
  column: AnyColumn | SQL;
  key: string;
  type: CursorValueType;
  direction?: CursorDirection;
  getValue: (row: Row) => CursorComparable;
}

interface PaginateByCursorOptions<Row> {
  query: BasePaginationQuery;
  scope: UnknownRecord;
  order: [CursorOrderField<Row>, ...CursorOrderField<Row>[]];
  selectRows: (params: {
    cursorPredicate: SQL<unknown> | SQLWrapper;
    limit: number;
    orderBy: SQL[];
  }) => Promise<Row[]>;
}

const CURSOR_VERSION = 1;

export const isValidCursorTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;

  const [date, time] = value.split('T');
  if (!date || !time) return false;
  const [yearText, monthText, dayText] = date.split('-');
  const [hourText, minuteText, secondFraction] = time.split(':');
  const secondText = secondFraction?.split('.')[0];
  if (!yearText || !monthText || !dayText || !hourText || !minuteText || !secondText) {
    return false;
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= (daysInMonth[month - 1] ?? 0);
};

const fingerprintScope = (scope: UnknownRecord): string => {
  const serialized = stringify(scope);
  if (serialized === undefined) {
    throw new InvariantViolationError('Invalid cursor scope');
  }

  return createHash('sha256').update(serialized).digest('base64url');
};

const parseCursorValue = (raw: unknown, type: CursorValueType): CursorComparable => {
  if (type === 'timestamp') {
    if (!isValidCursorTimestamp(raw)) {
      throw new InvariantViolationError('Invalid cursor');
    }

    return raw;
  }

  if (type === 'uuid') {
    if (typeof raw !== 'string' || !UUID_PATTERN.test(raw)) {
      throw new InvariantViolationError('Invalid cursor');
    }

    return raw;
  }

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
  if (type === 'timestamp') {
    if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) {
      throw new InvariantViolationError('Invalid cursor');
    }

    return value;
  }

  if (type === 'string' || type === 'uuid') {
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
  scope: UnknownRecord,
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

  const payload = decoded as UnknownRecord;
  if (
    payload.version !== CURSOR_VERSION ||
    payload.scope !== fingerprintScope(scope) ||
    typeof payload.values !== 'object' ||
    payload.values === null
  ) {
    throw new InvariantViolationError('Invalid cursor');
  }

  const values = payload.values as UnknownRecord;
  const cursorValues = new Map<string, CursorComparable>();

  for (const field of order) {
    if (!(field.key in values)) {
      throw new InvariantViolationError('Invalid cursor');
    }

    cursorValues.set(field.key, parseCursorValue(values[field.key], field.type));
  }

  return cursorValues;
};

const encodeCursor = <Row>(
  row: Row,
  scope: UnknownRecord,
  order: [CursorOrderField<Row>, ...CursorOrderField<Row>[]],
): string => {
  const values: UnknownRecord = {};

  for (const field of order) {
    values[field.key] = serializeCursorValue(field.getValue(row), field.type);
  }

  const payload: UnknownRecord = {
    version: CURSOR_VERSION,
    scope: fingerprintScope(scope),
    values,
  };

  const serialized = stringify(payload);
  if (serialized === undefined) {
    throw new InvariantViolationError('Invalid cursor');
  }
  return Buffer.from(serialized, 'utf8').toString('base64url');
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
    const column = field.column as SQL;
    // Raw SQL expressions have no column encoder, and exact timestamps are kept as strings so
    // JavaScript cannot discard PostgreSQL's microseconds.
    const bound =
      field.type === 'timestamp'
        ? sql`${cursorValue}::timestamptz`
        : cursorValue instanceof Date && field.column instanceof SQL
          ? sql`${cursorValue.toISOString()}::timestamptz`
          : cursorValue;
    const step = direction === 'desc' ? lt(column, bound) : gt(column, bound);
    const clause = previousEquals ? and(previousEquals, step) : step;

    if (clause) {
      clauses.push(clause);
    }

    const equals = eq(column, bound);
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
  const cursorValues = parseCursor(options.query.cursor, options.scope, options.order);
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
    nextCursor: hasNext && last ? encodeCursor(last, options.scope, options.order) : null,
  };
};

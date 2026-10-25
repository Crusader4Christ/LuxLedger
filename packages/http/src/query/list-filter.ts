import type { UnknownRecord } from '@luxledger/core/base';

export const MAX_WHERE_LENGTH = 8192;
const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;
export type FilterKind =
  | 'string'
  | 'uuid'
  | 'boolean'
  | 'number'
  | 'integer-string'
  | 'date-time'
  | 'enum';
export type FilterField = {
  kind: FilterKind;
  target?: string;
  nullable?: boolean;
  values?: readonly (string | number)[];
  ordered?: boolean;
};
export type FilterFields = Readonly<Record<string, FilterField>>;

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateTime =
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3}0*)?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/;
const validCalendarDate = (value: string): boolean => {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const daysInMonth = days[month - 1];
  return daysInMonth !== undefined && day >= 1 && day <= daysInMonth;
};

const parseValue = (value: unknown, field: FilterField): unknown => {
  if (value === null) return field.nullable ? null : undefined;
  switch (field.kind) {
    case 'string':
      return typeof value === 'string' ? value : undefined;
    case 'uuid':
      return typeof value === 'string' && uuid.test(value) ? value : undefined;
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    case 'integer-string':
      if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)$/.test(value)) return undefined;
      {
        const parsed = BigInt(value);
        return parsed >= INT64_MIN && parsed <= INT64_MAX ? parsed : undefined;
      }
    case 'date-time': {
      if (
        typeof value !== 'string' ||
        !dateTime.test(value) ||
        !validCalendarDate(value) ||
        Number(value.slice(11, 13)) > 23 ||
        Number(value.slice(14, 16)) > 59 ||
        Number(value.slice(17, 19)) > 59
      )
        return undefined;
      const parsed = new Date(value);
      return Number.isFinite(parsed.getTime()) ? parsed : undefined;
    }
    case 'enum':
      return typeof value === 'string' && field.values?.includes(value) ? value : undefined;
  }
};

export const parseWhere = <T>(raw: unknown, fields: FilterFields): T | undefined | null => {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_WHERE_LENGTH)
    return null;
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!record(input)) return null;
  if (Object.keys(input).length === 0) return undefined;
  const output: UnknownRecord = {};
  for (const [name, filter] of Object.entries(input)) {
    if (
      !Object.hasOwn(fields, name) ||
      Object.hasOwn(Object.prototype, name) ||
      !record(filter) ||
      !Object.keys(filter).length
    )
      return null;
    const field = fields[name];
    if (!field) return null;
    const parsed: UnknownRecord = {};
    for (const [operator, value] of Object.entries(filter)) {
      if (!['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte'].includes(operator)) return null;
      if (value === null && operator !== 'eq' && operator !== 'ne') return null;
      if (['gt', 'gte', 'lt', 'lte'].includes(operator) && !field.ordered) return null;
      if ((operator === 'eq' || operator === 'ne') && value === null && !field.nullable)
        return null;
      if (operator === 'in') {
        if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
        const values = value.map((v) => parseValue(v, { ...field, nullable: false }));
        if (values.some((v) => v === undefined)) return null;
        parsed[operator] = values;
      } else {
        const converted = parseValue(value, field);
        if (converted === undefined) return null;
        parsed[operator] = converted;
      }
    }
    output[field.target ?? name] = parsed;
  }
  return output as T;
};

export const whereFieldsToJsonSchema = (fields: FilterFields): UnknownRecord => ({
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [
      key,
      {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: Object.fromEntries(
          ['eq', 'ne', 'in', ...(field.ordered ? ['gt', 'gte', 'lt', 'lte'] : [])].map((op) => [
            op,
            op === 'in'
              ? {
                  type: 'array',
                  minItems: 1,
                  maxItems: 100,
                  items: scalarSchema({ ...field, nullable: false }),
                }
              : scalarSchema(operatorSchemaField(field, op)),
          ]),
        ),
      },
    ]),
  ),
});
const operatorSchemaField = (field: FilterField, operator: string): FilterField =>
  operator === 'eq' || operator === 'ne' ? field : { ...field, nullable: false };

export const whereQueryProperty = (fields: FilterFields): UnknownRecord => ({
  type: 'string',
  maxLength: MAX_WHERE_LENGTH,
  description: 'URL-encoded JSON object of typed list filters (maximum decoded length 8192 bytes).',
  contentMediaType: 'application/json',
  contentSchema: whereFieldsToJsonSchema(fields),
});

export const readWhereParameter = <T>(url: string, fields: FilterFields): T | undefined | null => {
  const params = new URL(url, 'http://localhost').searchParams;
  const values = params.getAll('where');
  if ([...params.keys()].some((key) => key.startsWith('where[') || key.startsWith('where.')))
    return null;
  if (values.length > 1) return null;
  return parseWhere<T>(values[0], fields);
};

export const invalidWhereError = (): Error & { validation: unknown[]; validationContext: string } =>
  Object.assign(new Error('Invalid querystring'), {
    validation: [{}],
    validationContext: 'querystring',
  });
const scalarSchema = (field: FilterField): UnknownRecord => ({
  ...(field.kind === 'integer-string'
    ? {
        type: 'string',
        pattern: '^-?(0|[1-9][0-9]*)$',
        description: 'Signed 64-bit integer encoded as a decimal string.',
      }
    : field.kind === 'date-time'
      ? {
          type: 'string',
          format: 'date-time',
          pattern: dateTime.source,
          description:
            'Timezone date-time exactly representable in milliseconds; submillisecond digits must be zero.',
        }
      : field.kind === 'uuid'
        ? { type: 'string', format: 'uuid' }
        : field.kind === 'enum'
          ? {
              type: field.nullable ? ['string', 'null'] : 'string',
              enum: field.nullable ? [...(field.values ?? []), null] : field.values,
            }
          : { type: field.kind }),
  ...(field.nullable && field.kind !== 'enum'
    ? {
        type: [
          field.kind === 'integer-string' || field.kind === 'date-time' || field.kind === 'uuid'
            ? 'string'
            : field.kind,
          'null',
        ],
      }
    : {}),
});

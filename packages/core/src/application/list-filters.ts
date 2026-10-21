import { InvariantViolationError } from './errors';

/** Fields and operators are ANDed. Null matches use eq/ne; in accepts 1–100 non-null values. */
export type FieldFilter<T> = {
  eq?: T;
  ne?: T;
  in?: readonly NonNullable<T>[];
} & (NonNullable<T> extends number | bigint | Date
  ? { gt?: NonNullable<T>; gte?: NonNullable<T>; lt?: NonNullable<T>; lte?: NonNullable<T> }
  : unknown);

type FieldValue<D> = D extends readonly (infer V)[]
  ? V
  : D extends `${infer K}?`
    ? FieldValue<K> | null
    : D extends 'date'
      ? Date
      : D extends 'bigint'
        ? bigint
        : D extends 'number'
          ? number
          : D extends 'boolean'
            ? boolean
            : string;
export type ListFilterResource = keyof typeof LIST_FILTER_FIELDS;
export type ListWhere<R extends ListFilterResource> = {
  [K in keyof (typeof LIST_FILTER_FIELDS)[R]]?: FieldFilter<
    FieldValue<(typeof LIST_FILTER_FIELDS)[R][K]>
  >;
};

/** Public allowlists; tenant scope and private fields are deliberately absent. */
export const LIST_FILTER_FIELDS = {
  account: {
    id: 'uuid',
    ledgerId: 'uuid',
    code: 'string?',
    name: 'string',
    side: ['DEBIT', 'CREDIT'],
    overdraftPolicy: ['ALLOW', 'DISALLOW'],
    grantEnabled: 'boolean',
    currency: 'string',
    assetId: 'uuid?',
    balanceMinor: 'bigint',
    createdAt: 'date',
  },
  transaction: {
    id: 'uuid',
    ledgerId: 'uuid',
    reference: 'string',
    currency: 'string',
    assetId: 'uuid?',
    description: 'string?',
    relatedTransactionId: 'uuid?',
    relationType: ['REVERSAL', 'CORRECTION', null],
    createdAt: 'date',
    effectiveAt: 'date',
  },
  entry: {
    id: 'uuid',
    transactionId: 'uuid',
    accountId: 'uuid',
    assetId: 'uuid?',
    signedAmountMinor: 'bigint',
    currency: 'string',
    createdAt: 'date',
  },
  asset: {
    id: 'uuid',
    code: 'string',
    scale: 'number',
    createdAt: 'date',
  },
  ledger: {
    id: 'uuid',
    name: 'string',
    createdAt: 'date',
  },
  apiKey: {
    id: 'uuid',
    name: 'string',
    role: ['ADMIN', 'SERVICE'],
    createdAt: 'date',
    revokedAt: 'date?',
  },
  reconRule: {
    id: 'uuid',
    name: 'string',
    description: 'string?',
    createdAt: 'date',
  },
  creditGrant: {
    id: 'uuid',
    ledgerId: 'uuid',
    accountId: 'uuid',
    fundingAccountId: 'uuid',
    reference: 'string',
    externalReference: 'string?',
    transactionId: 'uuid',
    createdAt: 'date',
    expiresAt: 'date?',
  },
  creditLineage: {
    grantId: 'uuid',
    entryId: 'uuid',
    transactionId: 'uuid',
    kind: ['CONSUMPTION', 'COMPENSATION', 'EXPIRATION', 'REFUND'],
    amountMinor: 'bigint',
    createdAt: 'date',
  },
  balanceHistory: {
    id: 'uuid',
    ledgerId: 'uuid',
    accountId: 'uuid',
    eventType: ['TX_APPLIED', 'HOLD_CREATED', 'HOLD_COMMITTED', 'HOLD_VOIDED', 'ADJUSTMENT'],
    sourceId: 'uuid',
    postedMinor: 'bigint',
    reservedDeltaMinor: 'bigint',
    effectiveAt: 'date',
    createdAt: 'date',
  },
} as const;

type Descriptor = string | readonly (string | null)[];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const validValue = (value: unknown, descriptor: Descriptor): boolean => {
  if (typeof descriptor !== 'string') return descriptor.some((item) => item === value);
  if (value === null) return descriptor.endsWith('?');
  switch (descriptor.replace('?', '')) {
    case 'uuid':
      return (
        typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      );
    case 'date':
      return value instanceof Date && Number.isFinite(value.getTime());
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'bigint':
      return typeof value === 'bigint';
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return typeof value === 'string';
  }
};

/** Runtime validation also protects JavaScript callers and repository implementations. */
export const validateListWhere = (resource: ListFilterResource, where: unknown): void => {
  if (where === undefined) return;
  if (!isRecord(where)) throw new InvariantViolationError('where must be an object');
  const fields: Readonly<Record<string, Descriptor>> = LIST_FILTER_FIELDS[resource];
  for (const [field, filter] of Object.entries(where)) {
    if (!Object.hasOwn(fields, field) || !isRecord(filter) || Object.keys(filter).length === 0) {
      throw new InvariantViolationError(`Invalid where field: ${field}`);
    }
    const descriptor = fields[field];
    const ordered =
      typeof descriptor === 'string' &&
      ['date', 'number', 'bigint'].includes(descriptor.replace('?', ''));
    for (const [operator, value] of Object.entries(filter)) {
      const valid =
        operator === 'in'
          ? Array.isArray(value) &&
            value.length > 0 &&
            value.length <= 100 &&
            Array.from(value).every((item) => item !== null && validValue(item, descriptor))
          : ['eq', 'ne'].includes(operator)
            ? validValue(value, descriptor)
            : ordered &&
              ['gt', 'gte', 'lt', 'lte'].includes(operator) &&
              value !== null &&
              validValue(value, descriptor);
      if (!valid)
        throw new InvariantViolationError(`Invalid where operator or value: ${field}.${operator}`);
    }
  }
};

/** Stable, type-preserving representation for binding pagination to the same filter. */
export const serializeListWhere = (where: unknown): string => {
  const encode = (value: unknown): unknown => {
    if (typeof value === 'bigint') return { bigint: value.toString() };
    if (value instanceof Date) return { date: value.toISOString() };
    if (Array.isArray(value)) return value.map(encode);
    if (isRecord(value))
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, encode(value[key])]),
      );
    return value;
  };
  return JSON.stringify(encode(where ?? {}));
};

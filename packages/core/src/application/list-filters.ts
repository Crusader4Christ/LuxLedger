import type { AccountEntity } from '../account/entity';
import type { ApiKeyEntity } from '../api-key/entity';
import type { Id } from '../base/id';
import type { EntryEntity } from '../entry/entity';
import type { LedgerEntity } from '../ledger/entity';
import type { ReconRule } from '../reconciliation';
import type { TransactionEntity } from '../transaction/entity';
import { InvariantViolationError } from './errors';
import type { Asset, BalanceSnapshotEvent, CreditGrant, CreditGrantLineage } from './types';

/** Fields and operators are ANDed. Null matches use eq/ne; in accepts 1–100 non-null values. */
export type FieldFilter<T> = {
  eq?: T;
  ne?: T;
  in?: readonly NonNullable<T>[];
} & (NonNullable<T> extends number | bigint | Date
  ? { gt?: NonNullable<T>; gte?: NonNullable<T>; lt?: NonNullable<T>; lte?: NonNullable<T> }
  : unknown);

// Entity types are the source of field types; only persisted IDs/timestamps are narrowed.
// Entry's Money value object is projected to the existing scalar query field names.
type Persisted<T, K extends keyof T> = Omit<T, K> & { [P in K]: NonNullable<T[P]> };
type FilterModels = {
  account: AccountEntity;
  transaction: Persisted<TransactionEntity, 'createdAt' | 'effectiveAt'>;
  entry: Persisted<EntryEntity, 'id' | 'transactionId' | 'createdAt'> & {
    signedAmountMinor: EntryEntity['money']['amountMinor'];
    currency: EntryEntity['money']['currency'];
  };
  asset: Asset;
  ledger: LedgerEntity;
  apiKey: ApiKeyEntity;
  reconRule: ReconRule;
  creditGrant: CreditGrant;
  creditLineage: CreditGrantLineage;
  balanceHistory: BalanceSnapshotEvent;
};

type Scalar = string | number | bigint | boolean | Date | null;
type FilterValue<T> = T extends Id ? T['value'] : T;
type ScalarKeys<T> = {
  [K in keyof T]-?: FilterValue<T[K]> extends Scalar ? K : never;
}[keyof T];

/** Explicit public allowlists; adding an entity field does not expose it for filtering. */
export const LIST_FILTER_FIELDS = {
  account: [
    'id',
    'ledgerId',
    'code',
    'name',
    'side',
    'overdraftPolicy',
    'grantEnabled',
    'currency',
    'assetId',
    'balanceMinor',
    'createdAt',
  ],
  transaction: [
    'id',
    'ledgerId',
    'reference',
    'currency',
    'assetId',
    'description',
    'relatedTransactionId',
    'relationType',
    'createdAt',
    'effectiveAt',
  ],
  entry: [
    'id',
    'transactionId',
    'accountId',
    'assetId',
    'signedAmountMinor',
    'currency',
    'createdAt',
  ],
  asset: ['id', 'code', 'scale', 'createdAt'],
  ledger: ['id', 'name', 'createdAt'],
  apiKey: ['id', 'name', 'role', 'createdAt', 'revokedAt'],
  reconRule: ['id', 'name', 'description', 'createdAt'],
  creditGrant: [
    'id',
    'ledgerId',
    'accountId',
    'fundingAccountId',
    'reference',
    'externalReference',
    'transactionId',
    'createdAt',
    'expiresAt',
  ],
  creditLineage: ['grantId', 'entryId', 'transactionId', 'kind', 'amountMinor', 'createdAt'],
  balanceHistory: [
    'id',
    'ledgerId',
    'accountId',
    'eventType',
    'sourceId',
    'postedMinor',
    'reservedDeltaMinor',
    'effectiveAt',
    'createdAt',
  ],
} as const satisfies {
  [R in keyof FilterModels]: readonly Exclude<
    ScalarKeys<FilterModels[R]>,
    'tenantId' | 'keyHash'
  >[];
};

export type ListFilterResource = keyof FilterModels;
export type ListWhere<R extends ListFilterResource> = {
  [K in (typeof LIST_FILTER_FIELDS)[R][number]]?: FieldFilter<
    FilterValue<FilterModels[R][K & keyof FilterModels[R]]>
  >;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const isOrderedValue = (value: unknown): boolean =>
  typeof value === 'bigint' ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (value instanceof Date && Number.isFinite(value.getTime()));
const isScalar = (value: unknown): boolean =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  isOrderedValue(value);

/**
 * Validate query structure and safe scalar values, not a second entity schema.
 * Field-specific types, enums and nullability are enforced by ListWhere at compile time.
 * Hosts accepting untyped input must validate it before calling a service.
 */
export const validateListWhere = (resource: ListFilterResource, where: unknown): void => {
  if (where === undefined) return;
  if (!isRecord(where)) throw new InvariantViolationError('where must be an object');
  const fields: readonly string[] = LIST_FILTER_FIELDS[resource];
  for (const [field, filter] of Object.entries(where)) {
    if (!fields.includes(field) || !isRecord(filter) || Object.keys(filter).length === 0) {
      throw new InvariantViolationError(`Invalid where field: ${field}`);
    }
    for (const [operator, value] of Object.entries(filter)) {
      const valid =
        operator === 'in'
          ? Array.isArray(value) &&
            value.length > 0 &&
            value.length <= 100 &&
            Array.from(value).every((item) => item !== null && isScalar(item))
          : operator === 'eq' || operator === 'ne'
            ? isScalar(value)
            : ['gt', 'gte', 'lt', 'lte'].includes(operator) && isOrderedValue(value);
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

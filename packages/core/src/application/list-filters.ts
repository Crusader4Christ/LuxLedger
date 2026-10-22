import type { Id } from '../base/id';
import { InvariantViolationError } from './errors';

/** Fields and operators are ANDed. Null matches use eq/ne; in accepts 1–100 non-null values. */
export type FieldFilter<T> = {
  eq?: T;
  ne?: T;
  in?: readonly NonNullable<T>[];
} & (NonNullable<T> extends number | bigint | Date
  ? { gt?: NonNullable<T>; gte?: NonNullable<T>; lt?: NonNullable<T>; lte?: NonNullable<T> }
  : unknown);

/** Scalar query values derive from the model; ID value objects use their string value. */
type Scalar = string | number | bigint | boolean | Date | null;
type FilterValue<T> = T extends Id ? T['value'] : T;
type ScalarKeys<T> = {
  [K in keyof T]-?: FilterValue<T[K]> extends Scalar ? K : never;
}[keyof T];

/** Narrow fields that are always present on persisted read models. */
export type PersistedFilterModel<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: NonNullable<T[P]>;
};

declare const filterModel: unique symbol;
export interface ListFilterPolicy {
  readonly exclude: readonly string[];
}
export interface ListFilter<Model, Excluded extends Extract<keyof Model, string>>
  extends ListFilterPolicy {
  readonly exclude: readonly Excluded[];
  readonly [filterModel]?: Model;
}

/** Place each operation's exclusions beside its model; no runtime model schema is copied. */
export const defineListFilter =
  <Model>() =>
  <const Excluded extends readonly Extract<keyof Model, string>[]>(options: {
    exclude: Excluded;
  }): ListFilter<Model, Excluded[number]> =>
    Object.freeze({
      exclude: Object.freeze([...options.exclude]),
    });

export type WhereFor<Policy> =
  Policy extends ListFilter<infer Model, infer Excluded>
    ? {
        [K in Exclude<ScalarKeys<Model>, Excluded | 'tenantId'>]?: FieldFilter<
          FilterValue<Model[K]>
        >;
      }
    : never;

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
 * Field-specific types, enums and nullability are enforced by WhereFor at compile time.
 * Adapters check field existence using their runtime schema.
 * Hosts accepting untyped input must validate it before calling a service.
 */
export const validateListWhere = (policy: ListFilterPolicy, where: unknown): void => {
  if (where === undefined) return;
  if (!isRecord(where)) throw new InvariantViolationError('where must be an object');
  for (const [field, filter] of Object.entries(where)) {
    if (
      field === 'tenantId' ||
      policy.exclude.includes(field) ||
      Object.hasOwn(Object.prototype, field) ||
      !isRecord(filter) ||
      Object.keys(filter).length === 0
    ) {
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

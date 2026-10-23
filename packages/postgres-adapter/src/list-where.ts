import {
  InvariantViolationError,
  type ListFilterPolicy,
  serializeListWhere,
  validateListWhere,
  type WhereFor,
} from '@luxledger/core/application';
import {
  type AnyColumn,
  and,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  type SQL,
} from 'drizzle-orm';

/** Column maps come from the existing schema; operation policy supplies exclusions. */
export const listWhereSql = <Policy extends ListFilterPolicy>(
  columns: Record<keyof WhereFor<Policy>, AnyColumn>,
  policy: Policy,
  where: WhereFor<NoInfer<Policy>> | undefined,
): SQL | undefined => {
  validateListWhere(policy, where);
  const clauses: SQL[] = [];
  for (const [field, filter] of Object.entries(
    (where ?? {}) as Record<string, Record<string, unknown>>,
  )) {
    if (!Object.hasOwn(columns, field)) {
      throw new InvariantViolationError(`Invalid where field: ${field}`);
    }
    const column = (columns as Record<string, AnyColumn>)[field];
    for (const [operator, value] of Object.entries(filter)) {
      switch (operator) {
        case 'eq':
          clauses.push(value === null ? isNull(column) : eq(column, value));
          break;
        case 'ne':
          clauses.push(value === null ? isNotNull(column) : ne(column, value));
          break;
        case 'in':
          clauses.push(inArray(column, value as unknown[]));
          break;
        case 'gt':
          clauses.push(gt(column, value));
          break;
        case 'gte':
          clauses.push(gte(column, value));
          break;
        case 'lt':
          clauses.push(lt(column, value));
          break;
        case 'lte':
          clauses.push(lte(column, value));
          break;
      }
    }
  }
  return and(...clauses);
};

/** Keep existing unfiltered cursor scopes compatible. */
export const listWhereScope = (where: unknown): Record<string, string> => {
  const serialized = serializeListWhere(where);
  return serialized === '{}' ? {} : { where: serialized };
};

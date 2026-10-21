import {
  type ListFilterResource,
  type ListWhere,
  serializeListWhere,
  validateListWhere,
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
import * as schema from './schema';

// Reuse table columns; the core allowlist is checked before any column is selected.
// Only joined projections need explicit mappings.
const columns = {
  account: schema.accounts,
  transaction: schema.transactions,
  entry: schema.entries,
  asset: schema.assets,
  ledger: schema.ledgers,
  apiKey: schema.apiKeys,
  reconRule: schema.reconRules,
  creditGrant: schema.creditGrants,
  creditLineage: {
    grantId: schema.creditGrantEntries.grantId,
    entryId: schema.creditGrantEntries.entryId,
    transactionId: schema.entries.transactionId,
    kind: schema.creditGrantEntries.kind,
    amountMinor: schema.creditGrantEntries.amountMinor,
    createdAt: schema.entries.createdAt,
  },
  balanceHistory: schema.balanceSnapshots,
} satisfies { [R in ListFilterResource]: Record<keyof ListWhere<R>, AnyColumn> };

export const listWhereSql = (resource: ListFilterResource, where: unknown): SQL | undefined => {
  validateListWhere(resource, where);
  const clauses: SQL[] = [];
  for (const [field, filter] of Object.entries(
    (where ?? {}) as Record<string, Record<string, unknown>>,
  )) {
    const column = (columns[resource] as Record<string, AnyColumn>)[field];
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

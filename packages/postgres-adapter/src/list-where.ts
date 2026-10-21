import {
  type ListFilterResource,
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

const columns: Record<ListFilterResource, Record<string, AnyColumn>> = {
  account: {
    id: schema.accounts.id,
    ledgerId: schema.accounts.ledgerId,
    code: schema.accounts.code,
    name: schema.accounts.name,
    side: schema.accounts.side,
    overdraftPolicy: schema.accounts.overdraftPolicy,
    grantEnabled: schema.accounts.grantEnabled,
    currency: schema.accounts.currency,
    assetId: schema.accounts.assetId,
    balanceMinor: schema.accounts.balanceMinor,
    createdAt: schema.accounts.createdAt,
  },
  transaction: {
    id: schema.transactions.id,
    ledgerId: schema.transactions.ledgerId,
    reference: schema.transactions.reference,
    currency: schema.transactions.currency,
    assetId: schema.transactions.assetId,
    description: schema.transactions.description,
    relatedTransactionId: schema.transactions.relatedTransactionId,
    relationType: schema.transactions.relationType,
    createdAt: schema.transactions.createdAt,
    effectiveAt: schema.transactions.effectiveAt,
  },
  entry: {
    id: schema.entries.id,
    transactionId: schema.entries.transactionId,
    accountId: schema.entries.accountId,
    assetId: schema.entries.assetId,
    signedAmountMinor: schema.entries.signedAmountMinor,
    currency: schema.entries.currency,
    createdAt: schema.entries.createdAt,
  },
  asset: {
    id: schema.assets.id,
    code: schema.assets.code,
    scale: schema.assets.scale,
    createdAt: schema.assets.createdAt,
  },
  ledger: { id: schema.ledgers.id, name: schema.ledgers.name, createdAt: schema.ledgers.createdAt },
  apiKey: {
    id: schema.apiKeys.id,
    name: schema.apiKeys.name,
    role: schema.apiKeys.role,
    createdAt: schema.apiKeys.createdAt,
    revokedAt: schema.apiKeys.revokedAt,
  },
  reconRule: {
    id: schema.reconRules.id,
    name: schema.reconRules.name,
    description: schema.reconRules.description,
    createdAt: schema.reconRules.createdAt,
  },
  creditGrant: {
    id: schema.creditGrants.id,
    ledgerId: schema.creditGrants.ledgerId,
    accountId: schema.creditGrants.accountId,
    fundingAccountId: schema.creditGrants.fundingAccountId,
    reference: schema.creditGrants.reference,
    externalReference: schema.creditGrants.externalReference,
    transactionId: schema.creditGrants.transactionId,
    createdAt: schema.creditGrants.createdAt,
    expiresAt: schema.creditGrants.expiresAt,
  },
  creditLineage: {
    grantId: schema.creditGrantEntries.grantId,
    entryId: schema.creditGrantEntries.entryId,
    transactionId: schema.entries.transactionId,
    kind: schema.creditGrantEntries.kind,
    amountMinor: schema.creditGrantEntries.amountMinor,
    createdAt: schema.entries.createdAt,
  },
  balanceHistory: {
    id: schema.balanceSnapshots.id,
    ledgerId: schema.balanceSnapshots.ledgerId,
    accountId: schema.balanceSnapshots.accountId,
    eventType: schema.balanceSnapshots.eventType,
    sourceId: schema.balanceSnapshots.sourceId,
    postedMinor: schema.balanceSnapshots.postedMinor,
    reservedDeltaMinor: schema.balanceSnapshots.reservedDeltaMinor,
    effectiveAt: schema.balanceSnapshots.effectiveAt,
    createdAt: schema.balanceSnapshots.createdAt,
  },
};

export const listWhereSql = (resource: ListFilterResource, where: unknown): SQL | undefined => {
  validateListWhere(resource, where);
  const clauses: SQL[] = [];
  for (const [field, filter] of Object.entries(
    (where ?? {}) as Record<string, Record<string, unknown>>,
  )) {
    const column = columns[resource][field];
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

import { AccountEntity, parseAccountSide, parseOverdraftPolicy } from '@luxledger/core';
import type * as schema from '../schema';

export const toAccountEntity = (row: typeof schema.accounts.$inferSelect): AccountEntity =>
  new AccountEntity({
    id: row.id,
    tenantId: row.tenantId,
    ledgerId: row.ledgerId,
    code: row.code,
    name: row.name,
    side: parseAccountSide(row.side),
    overdraftPolicy: parseOverdraftPolicy(row.overdraftPolicy),
    kind: row.kind,
    currency: row.currency,
    assetId: row.assetId,
    balanceMinor: row.balanceMinor,
    createdAt: row.createdAt,
  });

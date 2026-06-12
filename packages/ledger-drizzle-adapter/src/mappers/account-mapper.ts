import { AccountEntity, parseAccountSide, parseOverdraftPolicy } from '@lux/ledger';
import type * as schema from '../schema';

export const toAccountEntity = (row: typeof schema.accounts.$inferSelect): AccountEntity =>
  new AccountEntity({
    id: row.id,
    tenantId: row.tenantId,
    ledgerId: row.ledgerId,
    name: row.name,
    side: parseAccountSide(row.side),
    overdraftPolicy: parseOverdraftPolicy(row.overdraftPolicy),
    currency: row.currency,
    balanceMinor: row.balanceMinor,
    createdAt: row.createdAt,
  });

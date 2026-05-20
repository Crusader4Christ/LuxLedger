import type { AccountResponse } from '../contracts/accounts';
import type { AccountEntity } from '@lux/ledger';

export const toAccountResponse = (account: AccountEntity): AccountResponse => ({
  id: account.id,
  tenant_id: account.tenantId,
  ledger_id: account.ledgerId,
  name: account.name,
  side: account.side,
  currency: account.currency,
  balance_minor: account.balanceMinor.toString(),
  created_at: account.createdAt.toISOString(),
});

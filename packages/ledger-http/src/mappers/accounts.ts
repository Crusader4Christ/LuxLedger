import type { AccountEntity } from '@lux/ledger';
import type { AccountResponse } from '../contracts/accounts';

export const toAccountResponse = (account: AccountEntity): AccountResponse => ({
  id: account.id,
  tenant_id: account.tenantId,
  ledger_id: account.ledgerId,
  name: account.name,
  side: account.side,
  overdraft_policy: account.overdraftPolicy,
  currency: account.currency,
  balance_minor: account.balanceMinor.toString(),
  created_at: account.createdAt.toISOString(),
});

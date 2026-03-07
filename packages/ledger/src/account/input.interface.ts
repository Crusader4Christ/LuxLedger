import type { AccountSide } from './entity';

export interface CreateAccountInput {
  tenantId: string;
  ledgerId: string;
  name: string;
  side: AccountSide;
  currency: string;
}

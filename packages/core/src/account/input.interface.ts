import type { AccountSide, OverdraftPolicy } from './entity';

export interface CreateAccountInput {
  tenantId: string;
  ledgerId: string;
  name: string;
  side: AccountSide;
  overdraftPolicy?: OverdraftPolicy;
  currency: string;
}

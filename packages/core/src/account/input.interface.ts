import type { AccountSide, OverdraftPolicy } from './entity';

export interface CreateAccountInput {
  tenantId: string;
  ledgerId: string;
  code?: string | null;
  name: string;
  side: AccountSide;
  overdraftPolicy?: OverdraftPolicy;
  currency: string;
}

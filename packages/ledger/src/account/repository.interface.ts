import type { AccountEntity } from './entity';
import type { CreateAccountInput } from './input.interface';

export interface AccountRepository {
  createAccount(input: CreateAccountInput): Promise<AccountEntity>;
  findAccountById(tenantId: string, accountId: string): Promise<AccountEntity | null>;
}

import { AccountSide } from './entity';
import { InvalidAccountSideError } from './errors';

export function validateAccountSide(side: string): void {
  if (!(Object.values(AccountSide) as string[]).includes(side)) {
    throw new InvalidAccountSideError();
  }
}

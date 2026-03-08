import { InvalidAmountError, InvalidDirectionError } from '../transaction/errors';
import { EntryDirection } from './entity';

export function validateEntryDirection(direction: string): void {
  if (!(Object.values(EntryDirection) as string[]).includes(direction)) {
    throw new InvalidDirectionError();
  }
}

export function validateEntryAmount(amountMinor: bigint): void {
  if (amountMinor <= 0n) {
    throw new InvalidAmountError('amount must be positive');
  }
}

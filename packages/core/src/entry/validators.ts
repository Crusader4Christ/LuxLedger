import { InvalidAmountError } from '../transaction/errors';

export function validateSignedEntryAmount(signedAmountMinor: bigint): void {
  if (signedAmountMinor === 0n) {
    throw new InvalidAmountError('signed amount must not be zero');
  }
}

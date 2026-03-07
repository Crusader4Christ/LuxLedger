import { InvariantViolationError } from '../application/errors';

export const assertNonEmpty = (value: string, message: string): void => {
  if (value.trim().length === 0) {
    throw new InvariantViolationError(message);
  }
};

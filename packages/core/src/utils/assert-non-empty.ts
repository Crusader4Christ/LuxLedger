import { InvariantViolationError } from '../application/errors';
import { isNonEmptyString } from '../base/string';

export const assertNonEmpty = (value: string, message: string): void => {
  if (!isNonEmptyString(value)) {
    throw new InvariantViolationError(message);
  }
};

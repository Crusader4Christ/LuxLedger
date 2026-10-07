import type { TransactionMetadata } from '@luxledger/core';
import { InvariantViolationError } from '@luxledger/core/application';

export const MAX_TRANSACTION_METADATA_BYTES = 16 * 1024;

export const toStoredTransactionMetadata = (
  metadata: TransactionMetadata | undefined,
): TransactionMetadata | null => {
  if (metadata === undefined) {
    return null;
  }
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new InvariantViolationError('Transaction metadata must be a JSON object');
  }
  return metadata;
};

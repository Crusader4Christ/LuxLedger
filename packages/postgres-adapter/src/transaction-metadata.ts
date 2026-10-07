import type { TransactionMetadata } from '@luxledger/core';
import { InvariantViolationError } from '@luxledger/core/application';

// Keep retry comparisons bounded while leaving enough room for compact integration context.
export const MAX_TRANSACTION_METADATA_BYTES = 16 * 1024;
const utf8Encoder = new TextEncoder();

export const toStoredTransactionMetadata = (
  metadata: TransactionMetadata | undefined,
): TransactionMetadata | null => {
  if (metadata === undefined) {
    return null;
  }
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new InvariantViolationError('Transaction metadata must be a JSON object');
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(metadata);
  } catch {
    throw new InvariantViolationError('Transaction metadata must be a JSON object');
  }
  if (serialized === undefined) {
    throw new InvariantViolationError('Transaction metadata must be a JSON object');
  }
  if (utf8Encoder.encode(serialized).byteLength > MAX_TRANSACTION_METADATA_BYTES) {
    throw new InvariantViolationError(
      `Transaction metadata must not exceed ${MAX_TRANSACTION_METADATA_BYTES} bytes`,
    );
  }
  return metadata;
};

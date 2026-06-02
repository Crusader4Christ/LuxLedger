import type {
  CreateTransactionResponse,
  TransactionResponse,
} from '../contracts/transactions';
import { InvariantViolationError, type TransactionEntity } from '@lux/ledger';
import type { CreateTransactionResult } from '@lux/ledger/application';

export const toTransactionResponse = (transaction: TransactionEntity): TransactionResponse => {
  if (!transaction.tenantId || !transaction.reference || !transaction.createdAt) {
    throw new InvariantViolationError('transaction must be persisted before listing');
  }
  return {
    id: transaction.id.value,
    tenant_id: transaction.tenantId,
    ledger_id: transaction.ledgerId.value,
    reference: transaction.reference,
    currency: transaction.currency,
    description: transaction.description,
    related_transaction_id: transaction.relatedTransactionId,
    relation_type: transaction.relationType,
    created_at: transaction.createdAt.toISOString(),
  };
};

export const toCreateTransactionResponse = (
  result: CreateTransactionResult,
): CreateTransactionResponse => ({
  transaction_id: result.transactionId,
  created: result.created,
});

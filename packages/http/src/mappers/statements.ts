import type { AccountStatement, CreditLotStatement } from '@luxledger/core/application';
import type { AccountStatementResponse, CreditLotStatementResponse } from '../contracts/statements';

const toBalance = (balance: AccountStatement['opening']) => ({
  posted_minor: balance.postedMinor.toString(),
  reserved_delta_minor: balance.reservedDeltaMinor.toString(),
  available_minor: balance.availableMinor.toString(),
});

export const toAccountStatementResponse = (
  statement: AccountStatement,
): AccountStatementResponse => ({
  account_id: statement.accountId,
  asset_id: statement.assetId,
  from: statement.from.toISOString(),
  as_of: statement.asOf.toISOString(),
  opening: toBalance(statement.opening),
  closing: toBalance(statement.closing),
  data: statement.data.map((movement) => ({
    id: movement.id,
    event_type: movement.eventType,
    source_id: movement.sourceId,
    posted_delta_minor: movement.postedDeltaMinor.toString(),
    reserved_delta_minor: movement.reservedDeltaMinor.toString(),
    available_delta_minor: movement.availableDeltaMinor.toString(),
    effective_at: movement.effectiveAt.toISOString(),
    created_at: movement.createdAt.toISOString(),
  })),
  next_cursor: statement.nextCursor,
});

export const toCreditLotStatementResponse = (
  statement: CreditLotStatement,
): CreditLotStatementResponse => ({
  account_id: statement.accountId,
  asset_id: statement.assetId,
  grant_id: statement.grantId,
  from: statement.from.toISOString(),
  as_of: statement.asOf.toISOString(),
  opening_available_minor: statement.openingAvailableMinor.toString(),
  closing_available_minor: statement.closingAvailableMinor.toString(),
  data: statement.data.map((movement) => ({
    id: movement.id,
    grant_id: movement.grantId,
    kind: movement.kind,
    source_transaction_id: movement.sourceTransactionId,
    source_hold_id: movement.sourceHoldId,
    available_delta_minor: movement.availableDeltaMinor.toString(),
    remaining_minor: movement.remainingMinor.toString(),
    reserved_minor: movement.reservedMinor.toString(),
    available_minor: movement.availableMinor.toString(),
    effective_at: movement.effectiveAt.toISOString(),
    created_at: movement.createdAt.toISOString(),
  })),
  next_cursor: statement.nextCursor,
});

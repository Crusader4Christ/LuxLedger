import type { TransactionMetadata } from '@luxledger/core';
import {
  AccountNotFoundError,
  AdjustmentConflictError,
  type AdjustmentDirection,
  type AdjustmentRepository,
  type AdjustmentResult,
  type CreateAdjustmentInput,
} from '@luxledger/core/application';
import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../client';
import * as schema from '../schema';
import { DrizzleTransactionRepository } from './transaction-repository';

export class DrizzleAdjustmentRepository implements AdjustmentRepository {
  private readonly transactions: DrizzleTransactionRepository;

  public constructor(private readonly client: DbClient) {
    this.transactions = new DrizzleTransactionRepository(client);
  }

  public create(
    direction: AdjustmentDirection,
    input: CreateAdjustmentInput,
  ): Promise<AdjustmentResult> {
    return this.client.runTenantTx(input.tenantId, 'create adjustment', async (tx) => {
      const [account] = await tx
        .select({
          currency: schema.accounts.currency,
          grantEnabled: schema.accounts.grantEnabled,
        })
        .from(schema.accounts)
        .where(
          and(
            eq(schema.accounts.tenantId, input.tenantId),
            eq(schema.accounts.id, input.accountId),
          ),
        )
        .limit(1);
      if (!account) throw new AccountNotFoundError(input.accountId);
      if (direction === 'CREDIT' && account.grantEnabled) {
        throw new AdjustmentConflictError(
          'Credit adjustments cannot create grant capacity; issue a credit grant instead',
        );
      }

      const targetAmount = direction === 'DEBIT' ? input.amountMinor : -input.amountMinor;
      const metadata: TransactionMetadata = {
        adjustment: {
          direction,
          actor_id: input.actorId,
          reason_code: input.reasonCode,
          description: input.description,
          reference: input.reference,
          metadata: input.metadata ?? null,
        },
      };
      return this.transactions.postAdjustmentInTx(tx, {
        tenantId: input.tenantId,
        ledgerId: input.ledgerId,
        reference: input.reference,
        currency: account.currency,
        description: input.description,
        metadata,
        entries: [
          {
            accountId: input.accountId,
            signedAmountMinor: targetAmount,
            currency: account.currency,
          },
          {
            accountId: input.offsetAccountId,
            signedAmountMinor: -targetAmount,
            currency: account.currency,
          },
        ],
      });
    });
  }
}

import {
  type ListTransactionsQueryContract,
  listTransactionsQuerySchemaExtra,
  type TransactionByIdParamsContract,
  type TransactionResponseContract,
  transactionByIdParamsSchema,
} from '@api/contracts/transactions';
import { BasePaginatedRoute, type PaginatedRequest } from '@api/routes/pagination';
import { InvariantViolationError, type TransactionEntity } from '@lux/ledger';
import type { LedgerService } from '@lux/ledger/application';
import type { FastifyInstance } from 'fastify';

export class TransactionsRoutes extends BasePaginatedRoute<
  TransactionEntity,
  TransactionResponseContract,
  ListTransactionsQueryContract
> {
  protected readonly path = '/v1/transactions';

  public constructor(private readonly ledgerService: LedgerService) {
    super();
  }

  public register(server: FastifyInstance): void {
    super.register(server);
    this.registerGetTransactionById(server);
  }

  protected querystringSchema() {
    return super.querystringSchema(listTransactionsQuerySchemaExtra);
  }

  protected list(request: PaginatedRequest<ListTransactionsQueryContract>) {
    return this.ledgerService.listTransactions({
      tenantId: request.tenantId as string,
      limit: this.resolveLimit(request.query.limit),
      cursor: request.query.cursor,
      ledgerId: request.query.ledger_id,
    });
  }

  protected toDto(transaction: TransactionEntity): TransactionResponseContract {
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
      created_at: transaction.createdAt.toISOString(),
    };
  }

  private registerGetTransactionById(server: FastifyInstance): void {
    server.get<{ Params: TransactionByIdParamsContract }>(
      '/v1/transactions/:id',
      {
        schema: {
          params: transactionByIdParamsSchema,
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const transaction = await this.ledgerService.getTransactionById(
            request.tenantId as string,
            request.params.id,
          );
          return reply.status(200).send(this.dto(transaction));
        }),
    );
  }
}

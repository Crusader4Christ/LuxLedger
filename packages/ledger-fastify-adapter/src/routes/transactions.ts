import {
  type ListTransactionsQuery,
  listTransactionsQuerySchemaExtra,
  type TransactionByIdParams,
  type TransactionResponse,
  transactionByIdParamsSchema,
} from '@lux/ledger-http/contracts';
import { toTransactionResponse } from '@lux/ledger-http/mappers';
import { BasePaginatedRoute, type PaginatedRequest } from '../routes/pagination';
import type { TransactionEntity } from '@lux/ledger';
import type { LedgerService } from '@lux/ledger/application';
import type { FastifyInstance } from 'fastify';

export class TransactionsRoutes extends BasePaginatedRoute<
  TransactionEntity,
  TransactionResponse,
  ListTransactionsQuery
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

  protected list(request: PaginatedRequest<ListTransactionsQuery>) {
    return this.ledgerService.listTransactions({
      tenantId: request.tenantId as string,
      limit: this.resolveLimit(request.query.limit),
      cursor: request.query.cursor,
      ledgerId: request.query.ledger_id,
    });
  }

  protected toDto(transaction: TransactionEntity): TransactionResponse {
    return toTransactionResponse(transaction);
  }

  private registerGetTransactionById(server: FastifyInstance): void {
    server.get<{ Params: TransactionByIdParams }>(
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

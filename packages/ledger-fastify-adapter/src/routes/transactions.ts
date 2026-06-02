import {
  type CorrectTransactionRequest,
  type ListTransactionsQuery,
  reverseTransactionRequestSchema,
  correctTransactionRequestSchema,
  listTransactionsQuerySchemaExtra,
  type ReverseTransactionRequest,
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
    this.registerReverseTransaction(server);
    this.registerCorrectTransaction(server);
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

  private registerReverseTransaction(server: FastifyInstance): void {
    server.post<{ Params: TransactionByIdParams; Body: ReverseTransactionRequest }>(
      '/v1/transactions/:id/reverse',
      {
        schema: {
          params: transactionByIdParamsSchema,
          body: reverseTransactionRequestSchema,
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const result = await this.ledgerService.reverseTransaction({
            tenantId: request.tenantId as string,
            transactionId: request.params.id,
            reference: request.body.reference,
            description: request.body.description,
          });
          return reply
            .status(result.created ? 201 : 200)
            .send({ transaction_id: result.transactionId, created: result.created });
        }),
    );
  }

  private registerCorrectTransaction(server: FastifyInstance): void {
    server.post<{ Params: TransactionByIdParams; Body: CorrectTransactionRequest }>(
      '/v1/transactions/:id/correct',
      {
        schema: {
          params: transactionByIdParamsSchema,
          body: correctTransactionRequestSchema,
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const result = await this.ledgerService.correctTransaction({
            tenantId: request.tenantId as string,
            transactionId: request.params.id,
            reversalReference: request.body.reversal_reference,
            correctedReference: request.body.corrected_reference,
            description: request.body.description,
            entries: request.body.entries.map((entry) => ({
              accountId: entry.account_id,
              direction: entry.direction,
              amountMinor: BigInt(entry.amount_minor),
              currency: entry.currency,
            })),
          });
          return reply.status(result.created ? 201 : 200).send({
            reversal_transaction_id: result.reversalTransactionId,
            corrected_transaction_id: result.correctedTransactionId,
            created: result.created,
          });
        }),
    );
  }
}

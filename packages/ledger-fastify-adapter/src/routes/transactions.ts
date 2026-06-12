import type { TransactionEntity } from '@lux/ledger';
import type { TransactionService } from '@lux/ledger/application';
import {
  type CorrectTransactionRequest,
  correctTransactionRequestSchema,
  correctTransactionResponseSchema,
  type ListTransactionsQuery,
  listTransactionsQuerySchemaExtra,
  type ReverseTransactionRequest,
  reverseTransactionRequestSchema,
  reverseTransactionResponseSchema,
  type TransactionByIdParams,
  type TransactionResponse,
  transactionByIdParamsSchema,
  transactionResponseSchema,
  transactionsPageResponseSchema,
} from '@lux/ledger-http/contracts';
import { toTransactionResponse } from '@lux/ledger-http/mappers';
import type { FastifyInstance } from 'fastify';
import { BasePaginatedRoute, type PaginatedRequest } from '../routes/pagination';

export class TransactionsRoutes extends BasePaginatedRoute<
  TransactionEntity,
  TransactionResponse,
  ListTransactionsQuery
> {
  protected readonly path = '/v1/transactions';

  public constructor(private readonly transactions: TransactionService) {
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
    return this.transactions.list({
      tenantId: request.tenantId as string,
      limit: this.resolveLimit(request.query.limit),
      cursor: request.query.cursor,
      ledgerId: request.query.ledger_id,
    });
  }

  protected toDto(transaction: TransactionEntity): TransactionResponse {
    return toTransactionResponse(transaction);
  }

  protected responseSchema() {
    return transactionsPageResponseSchema;
  }

  private registerGetTransactionById(server: FastifyInstance): void {
    server.get<{ Params: TransactionByIdParams }>(
      '/v1/transactions/:id',
      {
        schema: {
          params: transactionByIdParamsSchema,
          response: { 200: transactionResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const transaction = await this.transactions.getById(
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
          response: {
            200: reverseTransactionResponseSchema,
            201: reverseTransactionResponseSchema,
          },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const result = await this.transactions.reverse({
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
          response: {
            200: correctTransactionResponseSchema,
            201: correctTransactionResponseSchema,
          },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const result = await this.transactions.correct({
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

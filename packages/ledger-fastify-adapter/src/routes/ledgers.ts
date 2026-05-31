import {
  type CreateLedgerRequest,
  createLedgerBodySchema,
  type CreateTransactionRequest,
  type CreateTransactionResponse,
  createTransactionRequestSchema,
  type LedgerByIdParams,
  ledgerByIdParamsSchema,
  ledgerResponseSchema,
  ledgersListResponseSchema,
  type TrialBalanceParams,
  trialBalanceParamsSchema,
  trialBalanceResponseSchema,
} from '@lux/ledger-http/contracts';
import { BaseRoute } from '../routes/base-route';
import { toTrialBalanceResponse } from '@lux/ledger-http/mappers';
import type { LedgerService } from '@lux/ledger/application';
import type { FastifyInstance } from 'fastify';

export class LedgerRoutes extends BaseRoute {
  public constructor(private readonly ledgerService: LedgerService) {
    super();
  }

  public register(server: FastifyInstance): void {
    this.registerCreateLedger(server);
    this.registerCreateTransaction(server);
    this.registerGetLedgerById(server);
    this.registerGetLedgers(server);
    this.registerGetTrialBalance(server);
  }

  private registerCreateLedger(server: FastifyInstance): void {
    server.post<{ Body: CreateLedgerRequest }>(
      '/v1/ledgers',
      {
        schema: {
          body: createLedgerBodySchema,
          response: {
            201: ledgerResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const { name } = request.body;

        return this.handle(reply, async () => {
          const ledger = await this.ledgerService.createLedger({
            tenantId: request.tenantId as string,
            name,
          });

          return reply.status(201).send(ledger);
        });
      },
    );
  }

  private registerCreateTransaction(server: FastifyInstance): void {
    server.post<{ Body: CreateTransactionRequest }>(
      '/v1/transactions',
      {
        schema: {
          body: createTransactionRequestSchema,
        },
      },
      async (request, reply) => {
        return this.handle(reply, async () => {
          const result = await this.ledgerService.createTransaction({
            tenantId: request.tenantId as string,
            ledgerId: request.body.ledger_id,
            reference: request.body.reference,
            currency: request.body.currency,
            description: request.body.description,
            entries: request.body.entries.map((entry) => ({
              accountId: entry.account_id,
              direction: entry.direction,
              amountMinor: BigInt(entry.amount_minor),
              currency: entry.currency,
            })),
          });

          const status = result.created ? 201 : 200;
          const response: CreateTransactionResponse = {
            transaction_id: result.transactionId,
            created: result.created,
          };
          return reply.status(status).send(response);
        });
      },
    );
  }

  private registerGetLedgerById(server: FastifyInstance): void {
    server.get<{ Params: LedgerByIdParams }>(
      '/v1/ledgers/:id',
      {
        schema: {
          params: ledgerByIdParamsSchema,
          response: {
            200: ledgerResponseSchema,
          },
        },
      },
      async (request, reply) => {
        return this.handle(reply, async () => {
          const ledger = await this.ledgerService.getLedgerById(
            request.tenantId as string,
            request.params.id,
          );
          return reply.status(200).send(ledger);
        });
      },
    );
  }

  private registerGetLedgers(server: FastifyInstance): void {
    server.get(
      '/v1/ledgers',
      {
        schema: {
          response: {
            200: ledgersListResponseSchema,
          },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const ledgers = await this.ledgerService.getLedgersByTenant(request.tenantId as string);
          return reply.status(200).send(ledgers);
        }),
    );
  }

  private registerGetTrialBalance(server: FastifyInstance): void {
    server.get<{ Params: TrialBalanceParams }>(
      '/v1/ledgers/:ledger_id/trial-balance',
      {
        schema: {
          params: trialBalanceParamsSchema,
          response: {
            200: trialBalanceResponseSchema,
          },
        },
      },
      async (request, reply) => {
        return this.handle(reply, async () => {
          const trialBalance = await this.ledgerService.getLedgerTrialBalance({
            tenantId: request.tenantId as string,
            ledgerId: request.params.ledger_id,
          });
          return reply.status(200).send(toTrialBalanceResponse(trialBalance));
        });
      },
    );
  }
}

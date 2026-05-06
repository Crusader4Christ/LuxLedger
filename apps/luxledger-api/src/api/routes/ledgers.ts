import {
  type CreateTransactionRequestContract,
  type CreateTransactionResponseContract,
  createTransactionRequestSchema,
} from '@api/contracts/transactions';
import { BaseRoute } from '@api/routes/base-route';
import { NonEmptyTrimmedStringSchema } from '@api/schema/common';
import type { LedgerService } from '@lux/ledger/application';
import type { FastifyInstance } from 'fastify';

interface CreateLedgerBody {
  name: string;
}

interface LedgerByIdParams {
  id: string;
}

interface TrialBalanceParams {
  ledger_id: string;
}

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
    server.post<{ Body: CreateLedgerBody }>(
      '/v1/ledgers',
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['name'],
            properties: {
              name: NonEmptyTrimmedStringSchema,
            },
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
    server.post<{ Body: CreateTransactionRequestContract }>(
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
          const response: CreateTransactionResponseContract = {
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
          params: {
            type: 'object',
            additionalProperties: false,
            required: ['id'],
            properties: {
              id: {
                type: 'string',
                format: 'uuid',
              },
            },
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
    server.get('/v1/ledgers', async (request, reply) =>
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
          params: {
            type: 'object',
            additionalProperties: false,
            required: ['ledger_id'],
            properties: {
              ledger_id: {
                type: 'string',
                format: 'uuid',
              },
            },
          },
        },
      },
      async (request, reply) => {
        return this.handle(reply, async () => {
          const trialBalance = await this.ledgerService.getTrialBalance({
            tenantId: request.tenantId as string,
            ledgerId: request.params.ledger_id,
          });
          return reply.status(200).send({
            ledger_id: trialBalance.ledgerId,
            accounts: trialBalance.accounts.map((account) => ({
              account_id: account.accountId,
              code: account.code,
              name: account.name,
              normal_balance: account.normalBalance,
              balance: account.balanceMinor.toString(),
              is_contra: account.isContra,
            })),
            total_debits: trialBalance.totalDebitsMinor.toString(),
            total_credits: trialBalance.totalCreditsMinor.toString(),
          });
        });
      },
    );
  }
}

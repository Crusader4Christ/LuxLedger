import { sendDomainError } from '@api/errors';
import { NonEmptyTrimmedStringSchema } from '@api/schema/common';
import type { LedgerService } from '@services/ledger-service';
import { EntryDirection } from '@services/types';
import type { FastifyInstance } from 'fastify';

interface LedgersRouteDependencies {
  ledgerService: LedgerService;
}
interface CreateLedgerBody {
  name: string;
}

interface CreateTransactionBody {
  ledger_id: string;
  reference: string;
  currency: string;
  entries: Array<{
    account_id: string;
    direction: EntryDirection;
    amount_minor: string;
    currency: string;
  }>;
}

interface LedgerByIdParams {
  id: string;
}

interface TrialBalanceParams {
  ledger_id: string;
}

export const registerLedgerRoutes = (
  server: FastifyInstance,
  dependencies: LedgersRouteDependencies,
): void => {
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

      try {
        const ledger = await dependencies.ledgerService.createLedger({
          tenantId: request.tenantId as string,
          name,
        });

        return reply.status(201).send(ledger);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  server.post<{ Body: CreateTransactionBody }>(
    '/v1/transactions',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['ledger_id', 'reference', 'currency', 'entries'],
          properties: {
            ledger_id: {
              type: 'string',
              format: 'uuid',
            },
            reference: NonEmptyTrimmedStringSchema,
            currency: NonEmptyTrimmedStringSchema,
            entries: {
              type: 'array',
              minItems: 2,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['account_id', 'direction', 'amount_minor', 'currency'],
                properties: {
                  account_id: {
                    type: 'string',
                    format: 'uuid',
                  },
                  direction: {
                    type: 'string',
                    enum: [...Object.values(EntryDirection)],
                  },
                  amount_minor: {
                    type: 'string',
                    pattern: '^[1-9][0-9]*$',
                  },
                  currency: NonEmptyTrimmedStringSchema,
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await dependencies.ledgerService.createTransaction({
          tenantId: request.tenantId as string,
          ledgerId: request.body.ledger_id,
          reference: request.body.reference,
          currency: request.body.currency,
          entries: request.body.entries.map((entry) => ({
            accountId: entry.account_id,
            direction: entry.direction,
            amountMinor: BigInt(entry.amount_minor),
            currency: entry.currency,
          })),
        });

        const status = result.created ? 201 : 200;
        return reply.status(status).send({
          transaction_id: result.transactionId,
          created: result.created,
        });
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

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
      try {
        const ledger = await dependencies.ledgerService.getLedgerById(
          request.tenantId as string,
          request.params.id,
        );
        return reply.status(200).send(ledger);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  server.get('/v1/ledgers', async (request, reply) => {
    try {
      const ledgers = await dependencies.ledgerService.getLedgersByTenant(
        request.tenantId as string,
      );
      return reply.status(200).send(ledgers);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

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
      try {
        const trialBalance = await dependencies.ledgerService.getTrialBalance({
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
          })),
          total_debits: trialBalance.totalDebitsMinor.toString(),
          total_credits: trialBalance.totalCreditsMinor.toString(),
        });
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );
};

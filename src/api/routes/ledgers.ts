import { sendDomainError } from '@api/errors';
import type { LedgerService } from '@core/ledger-service';
import type { LedgerReadService } from '@core/read-service';
import type { FastifyInstance } from 'fastify';

interface LedgersRouteDependencies {
  ledgerService: LedgerService;
  readService: LedgerReadService;
}
interface CreateLedgerBody {
  name: string;
}

interface LedgerByIdParams {
  id: string;
}

interface TrialBalanceParams {
  ledger_id: string;
}

const NON_EMPTY_TRIMMED_PATTERN = '^(?=.*\\S).+$';

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
            name: {
              type: 'string',
              pattern: NON_EMPTY_TRIMMED_PATTERN,
            },
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
        const trialBalance = await dependencies.readService.getTrialBalance({
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

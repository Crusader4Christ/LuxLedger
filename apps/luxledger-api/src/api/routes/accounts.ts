import { sendDomainError } from '@api/errors';
import { paginationQuerySchema, resolveLimit } from '@api/routes/pagination';
import type { AccountListItemDto } from '@api/routes/types/list-item-dto';
import { NonEmptyTrimmedStringSchema } from '@api/schema/common';
import type { AccountEntity, AccountSide, LedgerService } from '@lux/ledger';
import type { FastifyInstance } from 'fastify';

interface CreateAccountBody {
  ledger_id: string;
  name: string;
  side: string;
  currency: string;
}

interface AccountByIdParams {
  id: string;
}

interface ListAccountsQuery {
  limit?: number;
  cursor?: string;
  ledger_id?: string;
}

const accountListItemFromEntity = (account: AccountEntity): AccountListItemDto => ({
  id: account.id,
  tenant_id: account.tenantId,
  ledger_id: account.ledgerId,
  name: account.name,
  side: account.side,
  currency: account.currency,
  balance_minor: account.balanceMinor.toString(),
  created_at: account.createdAt.toISOString(),
});

export class AccountsRoutes {
  public constructor(private readonly ledgerService: LedgerService) {}

  public register(server: FastifyInstance): void {
    this.registerCreateAccount(server);
    this.registerGetAccountById(server);
    this.registerListAccounts(server);
  }

  private registerCreateAccount(server: FastifyInstance): void {
    server.post<{ Body: CreateAccountBody }>(
      '/v1/accounts',
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['ledger_id', 'name', 'side', 'currency'],
            properties: {
              ledger_id: {
                type: 'string',
                format: 'uuid',
              },
              name: NonEmptyTrimmedStringSchema,
              side: {
                ...NonEmptyTrimmedStringSchema,
              },
              currency: NonEmptyTrimmedStringSchema,
            },
          },
        },
      },
      async (request, reply) => {
        try {
          const account = await this.ledgerService.createAccount({
            tenantId: request.tenantId as string,
            ledgerId: request.body.ledger_id,
            name: request.body.name,
            side: request.body.side as AccountSide,
            currency: request.body.currency,
          });

          return reply.status(201).send(accountListItemFromEntity(account));
        } catch (error) {
          return sendDomainError(reply, error);
        }
      },
    );
  }

  private registerGetAccountById(server: FastifyInstance): void {
    server.get<{ Params: AccountByIdParams }>(
      '/v1/accounts/:id',
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
          const account = await this.ledgerService.getAccountById(
            request.tenantId as string,
            request.params.id,
          );
          return reply.status(200).send(accountListItemFromEntity(account));
        } catch (error) {
          return sendDomainError(reply, error);
        }
      },
    );
  }

  private registerListAccounts(server: FastifyInstance): void {
    server.get<{ Querystring: ListAccountsQuery }>(
      '/v1/accounts',
      {
        schema: {
          querystring: {
            ...paginationQuerySchema,
            properties: {
              ...paginationQuerySchema.properties,
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
          const page = await this.ledgerService.listAccounts({
            tenantId: request.tenantId as string,
            limit: resolveLimit(request.query.limit),
            cursor: request.query.cursor,
            ledgerId: request.query.ledger_id,
          });

          return reply.status(200).send({
            data: page.data.map(accountListItemFromEntity),
            next_cursor: page.nextCursor,
          });
        } catch (error) {
          return sendDomainError(reply, error);
        }
      },
    );
  }
}

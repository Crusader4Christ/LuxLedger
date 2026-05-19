import {
  type AccountByIdParams,
  type AccountResponse,
  accountByIdParamsSchema,
  accountResponseSchema,
  accountsPageResponseSchema,
  type CreateAccountRequest,
  createAccountBodySchema,
  type ListAccountsQuery,
  listAccountsQuerySchemaExtra,
} from '@lux/ledger-http/contracts/accounts';
import { resolveLimit, toAccountResponse } from '@lux/ledger-http/adapter-utils';
import { BaseEntityRoute } from '../routes/base-route';
import { mergePaginationQuerySchema } from '../routes/pagination';
import type { AccountListItemDto } from '../types/list-item-dto';
import type { AccountEntity, AccountSide, LedgerService } from '@lux/ledger';
import type { FastifyInstance } from 'fastify';

export class AccountsRoutes extends BaseEntityRoute<AccountEntity, AccountResponse> {
  public constructor(private readonly ledgerService: LedgerService) {
    super();
  }

  protected toDto(account: AccountEntity): AccountListItemDto {
    return toAccountResponse(account);
  }

  public register(server: FastifyInstance): void {
    this.registerCreateAccount(server);
    this.registerGetAccountById(server);
    this.registerListAccounts(server);
  }

  private registerCreateAccount(server: FastifyInstance): void {
    server.post<{ Body: CreateAccountRequest }>(
      '/v1/accounts',
      {
        schema: {
          body: createAccountBodySchema,
          response: {
            201: accountResponseSchema,
          },
        },
      },
      async (request, reply) => {
        return this.handle(reply, async () => {
          const account = await this.ledgerService.createAccount({
            tenantId: request.tenantId as string,
            ledgerId: request.body.ledger_id,
            name: request.body.name,
            side: request.body.side as AccountSide,
            currency: request.body.currency,
          });

          return reply.status(201).send(this.dto(account));
        });
      },
    );
  }

  private registerGetAccountById(server: FastifyInstance): void {
    server.get<{ Params: AccountByIdParams }>(
      '/v1/accounts/:id',
      {
        schema: {
          params: accountByIdParamsSchema,
          response: {
            200: accountResponseSchema,
          },
        },
      },
      async (request, reply) => {
        return this.handle(reply, async () => {
          const account = await this.ledgerService.getAccountById(
            request.tenantId as string,
            request.params.id,
          );
          return reply.status(200).send(this.dto(account));
        });
      },
    );
  }

  private registerListAccounts(server: FastifyInstance): void {
    server.get<{ Querystring: ListAccountsQuery }>(
      '/v1/accounts',
      {
        schema: {
          querystring: mergePaginationQuerySchema(listAccountsQuerySchemaExtra),
          response: {
            200: accountsPageResponseSchema,
          },
        },
      },
      async (request, reply) => {
        return this.handle(reply, async () => {
          const page = await this.ledgerService.listAccounts({
            tenantId: request.tenantId as string,
            limit: resolveLimit(request.query.limit),
            cursor: request.query.cursor,
            ledgerId: request.query.ledger_id,
          });

          return reply.status(200).send({
            data: this.dtoList(page.data),
            next_cursor: page.nextCursor,
          });
        });
      },
    );
  }
}

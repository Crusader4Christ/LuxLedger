import type { AccountEntity, AccountSide, LedgerService } from '@lux/ledger';
import {
  type AccountByIdParams,
  type AccountResponse,
  accountByIdParamsSchema,
  accountResponseSchema,
  accountsPageResponseSchema,
  type BalanceAsOfQuery,
  type BalanceHistoryQuery,
  balanceAsOfQuerySchema,
  balanceAsOfResponseSchema,
  balanceHistoryQuerySchema,
  balanceHistoryResponseSchema,
  type CreateAccountRequest,
  createAccountBodySchema,
  type ListAccountsQuery,
  listAccountsQuerySchemaExtra,
} from '@lux/ledger-http/contracts';
import { toAccountResponse } from '@lux/ledger-http/mappers';
import { resolveLimit } from '@lux/ledger-http/query/pagination';
import type { FastifyInstance } from 'fastify';
import { BaseEntityRoute } from '../routes/base-route';
import { mergePaginationQuerySchema } from '../routes/pagination';
import type { AccountListItemDto } from '../types/list-item-dto';

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
    this.registerGetBalanceAsOf(server);
    this.registerGetBalanceHistory(server);
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
            overdraftPolicy: request.body.overdraft_policy,
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

  private registerGetBalanceAsOf(server: FastifyInstance): void {
    server.get<{ Params: AccountByIdParams; Querystring: BalanceAsOfQuery }>(
      '/v1/accounts/:id/balance-as-of',
      {
        schema: {
          params: accountByIdParamsSchema,
          querystring: balanceAsOfQuerySchema,
          response: { 200: balanceAsOfResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const result = await this.ledgerService.getBalanceAt({
            tenantId: request.tenantId as string,
            accountId: request.params.id,
            at: new Date(request.query.at),
          });
          return reply.status(200).send({
            account_id: result.accountId,
            timestamp: result.at.toISOString(),
            posted_minor: result.postedMinor.toString(),
            inflight_debit_minor: result.inflightDebitMinor.toString(),
            inflight_credit_minor: result.inflightCreditMinor.toString(),
            available_minor: result.availableMinor.toString(),
          });
        }),
    );
  }

  private registerGetBalanceHistory(server: FastifyInstance): void {
    server.get<{ Params: AccountByIdParams; Querystring: BalanceHistoryQuery }>(
      '/v1/accounts/:id/balance-history',
      {
        schema: {
          params: accountByIdParamsSchema,
          querystring: balanceHistoryQuerySchema,
          response: { 200: balanceHistoryResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const page = await this.ledgerService.listBalanceHistory({
            tenantId: request.tenantId as string,
            accountId: request.params.id,
            from: new Date(request.query.from),
            to: new Date(request.query.to),
            limit: resolveLimit(request.query.limit),
            cursor: request.query.cursor,
          });
          return reply.status(200).send({
            data: page.data.map((item) => ({
              id: item.id,
              tenant_id: item.tenantId,
              ledger_id: item.ledgerId,
              account_id: item.accountId,
              event_type: item.eventType,
              source_id: item.sourceId,
              posted_minor: item.postedMinor.toString(),
              inflight_debit_minor: item.inflightDebitMinor.toString(),
              inflight_credit_minor: item.inflightCreditMinor.toString(),
              effective_at: item.effectiveAt.toISOString(),
              created_at: item.createdAt.toISOString(),
            })),
            next_cursor: page.nextCursor,
          });
        }),
    );
  }
}

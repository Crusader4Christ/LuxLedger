import type { AccountEntity, AccountSide } from '@luxledger/core';
import type {
  AccountService,
  accountListFilter,
  BalanceService,
  balanceHistoryListFilter,
  StatementService,
  WhereFor,
} from '@luxledger/core/application';
import {
  accountFilterFields,
  balanceHistoryFilterFields,
  invalidWhereError,
  readWhereParameter,
  whereQueryProperty,
} from '@luxledger/http';
import {
  type AccountByIdParams,
  type AccountResponse,
  accountByIdParamsSchema,
  accountResponseSchema,
  accountStatementResponseSchema,
  accountsPageResponseSchema,
  type BalanceAsOfQuery,
  type BalanceHistoryQuery,
  balanceAsOfQuerySchema,
  balanceAsOfResponseSchema,
  balanceHistoryQuerySchema,
  balanceHistoryResponseSchema,
  type CreateAccountRequest,
  type CreditLotStatementQuery,
  createAccountBodySchema,
  creditLotStatementQuerySchema,
  creditLotStatementResponseSchema,
  type ListAccountsQuery,
  listAccountsQuerySchemaExtra,
  type StatementQuery,
  statementQuerySchema,
} from '@luxledger/http/contracts';
import { invalidInputPayload } from '@luxledger/http/errors';
import {
  toAccountResponse,
  toAccountStatementResponse,
  toCreditLotStatementResponse,
} from '@luxledger/http/mappers';
import type { FastifyInstance } from 'fastify';
import { handleValidationError } from '../errors/validation-error-handler';
import { createPaginationQuerySchema, resolvePaginationLimit } from '../query/pagination';
import { BaseEntityRoute } from '../routing/base-route';

export class AccountsRoutes extends BaseEntityRoute<AccountEntity, AccountResponse> {
  public constructor(
    private readonly accounts: AccountService,
    private readonly balances: BalanceService,
    private readonly statements: StatementService,
  ) {
    super();
  }

  protected toDto(account: AccountEntity): AccountResponse {
    return toAccountResponse(account);
  }

  public register(server: FastifyInstance): void {
    this.registerCreateAccount(server);
    this.registerGetAccountById(server);
    this.registerListAccounts(server);
    this.registerGetBalanceAsOf(server);
    this.registerGetBalanceHistory(server);
    this.registerStatements(server);
  }

  private registerCreateAccount(server: FastifyInstance): void {
    server.post<{ Body: CreateAccountRequest }>(
      '/v1/accounts',
      {
        errorHandler: handleValidationError,
        schema: {
          body: createAccountBodySchema,
          response: {
            201: accountResponseSchema,
          },
        },
      },
      async (request, reply) => {
        return this.handle(reply, async () => {
          const account = await this.accounts.create({
            tenantId: request.tenantId as string,
            ledgerId: request.body.ledger_id,
            code: request.body.code,
            name: request.body.name,
            side: request.body.side as AccountSide,
            overdraftPolicy: request.body.overdraft_policy,
            grantEnabled: request.body.grant_enabled,
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
        errorHandler: handleValidationError,
        schema: {
          params: accountByIdParamsSchema,
          response: {
            200: accountResponseSchema,
          },
        },
      },
      async (request, reply) => {
        return this.handle(reply, async () => {
          const account = await this.accounts.getById(
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
        errorHandler: handleValidationError,
        schema: {
          querystring: createPaginationQuerySchema({
            ...listAccountsQuerySchemaExtra,
            properties: {
              ...listAccountsQuerySchemaExtra.properties,
              where: whereQueryProperty(accountFilterFields),
            },
          }),
          response: {
            200: accountsPageResponseSchema,
          },
        },
      },
      async (request, reply) => {
        return this.handle(reply, async () => {
          const where = readWhereParameter<WhereFor<typeof accountListFilter>>(
            request.raw.url ?? '',
            accountFilterFields,
          );
          if (where === null)
            return reply.status(400).send(invalidInputPayload('Invalid querystring'));
          const page = await this.accounts.list({
            tenantId: request.tenantId as string,
            limit: resolvePaginationLimit(request.query.limit),
            cursor: request.query.cursor,
            ledgerId: request.query.ledger_id,
            where,
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
        errorHandler: handleValidationError,
        schema: {
          params: accountByIdParamsSchema,
          querystring: balanceAsOfQuerySchema,
          response: { 200: balanceAsOfResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const result = await this.balances.getAt({
            tenantId: request.tenantId as string,
            accountId: request.params.id,
            at: new Date(request.query.at),
          });
          return reply.status(200).send({
            account_id: result.accountId,
            timestamp: result.at.toISOString(),
            posted_minor: result.postedMinor.toString(),
            reserved_delta_minor: result.reservedDeltaMinor.toString(),
            available_minor: result.availableMinor.toString(),
          });
        }),
    );
  }

  private registerGetBalanceHistory(server: FastifyInstance): void {
    server.get<{
      Params: AccountByIdParams;
      Querystring: BalanceHistoryQuery & { where?: string };
    }>(
      '/v1/accounts/:id/balance-history',
      {
        errorHandler: handleValidationError,
        schema: {
          params: accountByIdParamsSchema,
          querystring: {
            ...balanceHistoryQuerySchema,
            properties: {
              ...balanceHistoryQuerySchema.properties,
              where: whereQueryProperty(balanceHistoryFilterFields),
            },
          },
          response: { 200: balanceHistoryResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const where = readWhereParameter<WhereFor<typeof balanceHistoryListFilter>>(
            request.raw.url ?? '',
            balanceHistoryFilterFields,
          );
          if (where === null) throw invalidWhereError();
          const page = await this.balances.listHistory({
            tenantId: request.tenantId as string,
            accountId: request.params.id,
            from: new Date(request.query.from),
            to: new Date(request.query.to),
            limit: resolvePaginationLimit(request.query.limit),
            cursor: request.query.cursor,
            where,
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
              reserved_delta_minor: item.reservedDeltaMinor.toString(),
              effective_at: item.effectiveAt.toISOString(),
              created_at: item.createdAt.toISOString(),
            })),
            next_cursor: page.nextCursor,
          });
        }),
    );
  }

  private registerStatements(server: FastifyInstance): void {
    server.get<{ Params: AccountByIdParams; Querystring: StatementQuery }>(
      '/v1/accounts/:id/statement',
      {
        errorHandler: handleValidationError,
        schema: {
          params: accountByIdParamsSchema,
          querystring: statementQuerySchema,
          response: { 200: accountStatementResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () =>
          reply.status(200).send(
            toAccountStatementResponse(
              await this.statements.getAccountStatement({
                tenantId: request.tenantId as string,
                accountId: request.params.id,
                from: new Date(request.query.from),
                asOf: new Date(request.query.as_of),
                limit: resolvePaginationLimit(request.query.limit),
                cursor: request.query.cursor,
              }),
            ),
          ),
        ),
    );

    server.get<{ Params: AccountByIdParams; Querystring: CreditLotStatementQuery }>(
      '/v1/accounts/:id/credit-statement',
      {
        errorHandler: handleValidationError,
        schema: {
          params: accountByIdParamsSchema,
          querystring: creditLotStatementQuerySchema,
          response: { 200: creditLotStatementResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () =>
          reply.status(200).send(
            toCreditLotStatementResponse(
              await this.statements.getCreditLotStatement({
                tenantId: request.tenantId as string,
                accountId: request.params.id,
                grantId: request.query.grant_id,
                from: new Date(request.query.from),
                asOf: new Date(request.query.as_of),
                limit: resolvePaginationLimit(request.query.limit),
                cursor: request.query.cursor,
              }),
            ),
          ),
        ),
    );
  }
}

import {
  ApiKeyRole,
  type AccountByIdParams,
  createAccountBodySchema,
  type CreateAccountRequest,
  createApiKeyBodySchema,
  type CreateApiKeyRequest,
  createLedgerBodySchema,
  type CreateLedgerRequest,
  createTransactionRequestSchema,
  type CreateTransactionRequest,
  type CreateTransactionResponse,
  type LedgerByIdParams,
  type ListAccountsQuery,
  type ListEntriesQuery,
  type ListTransactionsQuery,
  type RevokeApiKeyParams,
  type TrialBalanceParams,
  type TransactionByIdParams,
} from '@lux/ledger-http/contracts';
import {
  toAccountResponse,
  toApiKeyContract,
  toEntryResponse,
  toTrialBalanceResponse,
  toTransactionResponse,
} from '@lux/ledger-http/mappers';
import { parseCursorQuery, parseLimitQuery, parseUuidQuery } from '@lux/ledger-http/query/pagination';
import { invalidInputPayload, toHttpErrorPayload } from '@lux/ledger-http/errors';
import { withErrorHandling } from '@lux/ledger-http/route-core';
import { parseUuidParam } from '@lux/ledger-http/validation-utils';
import { AccountSide } from '@lux/ledger';
import {
  ForbiddenError,
  type ApiKeyService,
  type LedgerService,
  UnauthorizedError,
} from '@lux/ledger/application';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import express, { type Application, type Request, type Response } from 'express';

type RequestContext = {
  tenantId: string;
  apiKeyId: string;
  apiKeyRole: ApiKeyRole;
};

type RequestWithContext = Request & Partial<RequestContext>;

export type ExpressLedgerAdapterDependencies = {
  ledgerService: LedgerService;
  apiKeyService: ApiKeyService;
};

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validators = new Map<object, ValidateFunction>();

const sendInvalidInput = (res: Response, message: string): Response =>
  res.status(400).json(invalidInputPayload(message));

const sendDomainError = (res: Response, error: unknown): Response => {
  const payload = toHttpErrorPayload(error);
  return res.status(payload.statusCode).json({
    error: payload.error,
    message: payload.message,
  });
};

const withDomainErrorHandling = async (
  res: Response,
  handler: () => Promise<void>,
): Promise<void> => {
  await withErrorHandling(handler, (error) => {
    sendDomainError(res, error);
  });
};

const requireContext = (req: RequestWithContext): RequestContext => {
  if (!req.tenantId || !req.apiKeyId || !req.apiKeyRole) {
    throw new UnauthorizedError('Bearer token is required');
  }
  return {
    tenantId: req.tenantId,
    apiKeyId: req.apiKeyId,
    apiKeyRole: req.apiKeyRole,
  };
};

const validate = <T>(schema: object, value: unknown): T | null => {
  const validator = validators.get(schema) ?? ajv.compile(schema);
  if (!validators.has(schema)) {
    validators.set(schema, validator);
  }
  return validator(value) ? (value as T) : null;
};

const assertAdmin = (context: RequestContext): void => {
  if (context.apiKeyRole !== ApiKeyRole.ADMIN) {
    throw new ForbiddenError('Admin API key is required');
  }
};

const ensureJsonMiddleware = (app: Application): void => {
  const stack = (app as Application & { _router?: { stack?: unknown[] } })._router?.stack;
  if (!Array.isArray(stack) || stack.length === 0) {
    app.use(express.json());
  }
};

export const registerLedgerAdapter = (
  app: Application,
  dependencies: ExpressLedgerAdapterDependencies,
): void => {
  ensureJsonMiddleware(app);

  app.post('/v1/ledgers', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<CreateLedgerRequest>(createLedgerBodySchema, req.body);
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const ledger = await dependencies.ledgerService.createLedger({
        tenantId: context.tenantId,
        name: body.name,
      });
      res.status(201).json(ledger);
    }),
  );

  app.get('/v1/ledgers', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const context = requireContext(req);
      const ledgers = await dependencies.ledgerService.getLedgersByTenant(context.tenantId);
      res.status(200).json(ledgers);
    }),
  );

  app.get('/v1/ledgers/:id', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof LedgerByIdParams>(req.params.id, 'id');
      if (params === null) {
        sendInvalidInput(res, 'Invalid path parameter');
        return;
      }
      const context = requireContext(req);
      const ledger = await dependencies.ledgerService.getLedgerById(context.tenantId, params.id);
      res.status(200).json(ledger);
    }),
  );

  app.get('/v1/ledgers/:ledger_id/trial-balance', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof TrialBalanceParams>(req.params.ledger_id, 'ledger_id');
      if (params === null) {
        sendInvalidInput(res, 'Invalid path parameter');
        return;
      }
      const context = requireContext(req);
      const trialBalance = await dependencies.ledgerService.getTrialBalance({
        tenantId: context.tenantId,
        ledgerId: params.ledger_id,
      });
      res.status(200).json(toTrialBalanceResponse(trialBalance));
    }),
  );

  app.post('/v1/transactions', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<CreateTransactionRequest>(createTransactionRequestSchema, req.body);
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const result = await dependencies.ledgerService.createTransaction({
        tenantId: context.tenantId,
        ledgerId: body.ledger_id,
        reference: body.reference,
        currency: body.currency,
        description: body.description,
        entries: body.entries.map((entry) => ({
          accountId: entry.account_id,
          direction: entry.direction,
          amountMinor: BigInt(entry.amount_minor),
          currency: entry.currency,
        })),
      });
      const response: CreateTransactionResponse = {
        transaction_id: result.transactionId,
        created: result.created,
      };
      res.status(result.created ? 201 : 200).json(response);
    }),
  );

  app.get('/v1/transactions/:id', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof TransactionByIdParams>(req.params.id, 'id');
      if (params === null) {
        sendInvalidInput(res, 'Invalid path parameter');
        return;
      }
      const context = requireContext(req);
      const transaction = await dependencies.ledgerService.getTransactionById(context.tenantId, params.id);
      res.status(200).json(toTransactionResponse(transaction));
    }),
  );

  app.get('/v1/transactions', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const limit = parseLimitQuery(req.query.limit);
      const cursor = parseCursorQuery(req.query.cursor);
      const ledgerId = parseUuidQuery(req.query.ledger_id);
      if (limit === null || (req.query.cursor !== undefined && cursor === null)) {
        sendInvalidInput(res, 'Invalid querystring');
        return;
      }
      if (req.query.ledger_id !== undefined && ledgerId === null) {
        sendInvalidInput(res, 'Invalid querystring');
        return;
      }
      const resolvedLimit = limit ?? 50;
      const query: ListTransactionsQuery = {
        limit: resolvedLimit,
        cursor: cursor ?? undefined,
        ledger_id: ledgerId ?? undefined,
      };
      const context = requireContext(req);
      const page = await dependencies.ledgerService.listTransactions({
        tenantId: context.tenantId,
        limit: resolvedLimit,
        cursor: query.cursor,
        ledgerId: query.ledger_id,
      });
      res.status(200).json({
        data: page.data.map(toTransactionResponse),
        next_cursor: page.nextCursor,
      });
    }),
  );

  app.post('/v1/accounts', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<CreateAccountRequest>(createAccountBodySchema, req.body);
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const account = await dependencies.ledgerService.createAccount({
        tenantId: context.tenantId,
        ledgerId: body.ledger_id,
        name: body.name,
        side: body.side === 'DEBIT' ? AccountSide.DEBIT : AccountSide.CREDIT,
        currency: body.currency,
      });
      res.status(201).json(toAccountResponse(account));
    }),
  );

  app.get('/v1/accounts/:id', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof AccountByIdParams>(req.params.id, 'id');
      if (params === null) {
        sendInvalidInput(res, 'Invalid path parameter');
        return;
      }
      const context = requireContext(req);
      const account = await dependencies.ledgerService.getAccountById(context.tenantId, params.id);
      res.status(200).json(toAccountResponse(account));
    }),
  );

  app.get('/v1/accounts', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const limit = parseLimitQuery(req.query.limit);
      const cursor = parseCursorQuery(req.query.cursor);
      const ledgerId = parseUuidQuery(req.query.ledger_id);
      if (limit === null || (req.query.cursor !== undefined && cursor === null)) {
        sendInvalidInput(res, 'Invalid querystring');
        return;
      }
      if (req.query.ledger_id !== undefined && ledgerId === null) {
        sendInvalidInput(res, 'Invalid querystring');
        return;
      }
      const resolvedLimit = limit ?? 50;
      const query: ListAccountsQuery = {
        limit: resolvedLimit,
        cursor: cursor ?? undefined,
        ledger_id: ledgerId ?? undefined,
      };
      const context = requireContext(req);
      const page = await dependencies.ledgerService.listAccounts({
        tenantId: context.tenantId,
        limit: resolvedLimit,
        cursor: query.cursor,
        ledgerId: query.ledger_id,
      });
      res.status(200).json({
        data: page.data.map(toAccountResponse),
        next_cursor: page.nextCursor,
      });
    }),
  );

  app.get('/v1/entries', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const limit = parseLimitQuery(req.query.limit);
      const cursor = parseCursorQuery(req.query.cursor);
      if (limit === null || (req.query.cursor !== undefined && cursor === null)) {
        sendInvalidInput(res, 'Invalid querystring');
        return;
      }
      const resolvedLimit = limit ?? 50;
      const query: ListEntriesQuery = {
        limit: resolvedLimit,
        cursor: cursor ?? undefined,
      };
      const context = requireContext(req);
      const page = await dependencies.ledgerService.listEntries({
        tenantId: context.tenantId,
        limit: resolvedLimit,
        cursor: query.cursor,
      });
      res.status(200).json({
        data: page.data.map(toEntryResponse),
        next_cursor: page.nextCursor,
      });
    }),
  );

  app.get('/v1/admin/api-keys', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const context = requireContext(req);
      assertAdmin(context);
      const keys = await dependencies.apiKeyService.listApiKeys({
        apiKeyId: context.apiKeyId,
        tenantId: context.tenantId,
        role: context.apiKeyRole,
      });
      res.status(200).json({
        data: keys.map(toApiKeyContract),
      });
    }),
  );

  app.post('/v1/admin/api-keys', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<CreateApiKeyRequest>(createApiKeyBodySchema, req.body);
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      assertAdmin(context);
      const created = await dependencies.apiKeyService.createApiKey(
        {
          apiKeyId: context.apiKeyId,
          tenantId: context.tenantId,
          role: context.apiKeyRole,
        },
        {
          tenantId: context.tenantId,
          name: body.name,
          role: body.role,
        },
      );
      res.status(201).json({
        api_key: created.apiKey,
        key: toApiKeyContract(created.key),
      });
    }),
  );

  app.post('/v1/admin/api-keys/:id/revoke', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof RevokeApiKeyParams>(req.params.id, 'id');
      if (params === null) {
        sendInvalidInput(res, 'Invalid path parameter');
        return;
      }
      const context = requireContext(req);
      assertAdmin(context);
      await dependencies.apiKeyService.revokeApiKey(
        {
          apiKeyId: context.apiKeyId,
          tenantId: context.tenantId,
          role: context.apiKeyRole,
        },
        params.id,
      );
      res.status(204).send();
    }),
  );
};

export const registerLedgerExpressAdapter = registerLedgerAdapter;

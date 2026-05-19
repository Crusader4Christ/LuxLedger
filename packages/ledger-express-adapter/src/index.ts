import type {
  AccountByIdParams,
  CreateAccountRequest,
  ListAccountsQuery,
} from '@lux/ledger-http/accounts';
import {
  ApiKeyRole,
  type CreateApiKeyRequest,
  type RevokeApiKeyParams,
} from '@lux/ledger-http/auth-admin';
import type { ListEntriesQuery } from '@lux/ledger-http/entries';
import type {
  CreateLedgerRequest,
  LedgerByIdParams,
  TrialBalanceParams,
  TrialBalanceResponse,
} from '@lux/ledger-http/ledgers';
import type {
  CreateTransactionRequest,
  CreateTransactionResponse,
  ListTransactionsQuery,
  TransactionByIdParams,
} from '@lux/ledger-http/transactions';
import {
  parseCursorQuery,
  parseLimitQuery,
  parseUuidQuery,
  toAccountResponse,
  toApiKeyContract,
  toEntryResponse,
  toTransactionResponse,
} from '@lux/ledger-http/adapter-utils';
import { invalidInputPayload, toHttpErrorPayload } from '@lux/ledger-http/errors';
import {
  isNonEmptyTrimmed,
  isRecord,
  isUuid,
  parseUuidParam,
} from '@lux/ledger-http/validation-utils';
import { AccountSide } from '@lux/ledger';
import {
  ForbiddenError,
  type ApiKeyService,
  type LedgerService,
  UnauthorizedError,
} from '@lux/ledger/application';
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

const POSITIVE_INT_STRING_PATTERN = /^[1-9][0-9]*$/;

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
  try {
    await handler();
  } catch (error) {
    sendDomainError(res, error);
  }
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


const parseCreateLedgerBody = (body: unknown): CreateLedgerRequest | null => {
  if (!isRecord(body)) {
    return null;
  }
  if (Object.keys(body).length !== 1 || !('name' in body)) {
    return null;
  }
  if (!isNonEmptyTrimmed(body.name)) {
    return null;
  }
  return { name: body.name };
};

const parseCreateAccountBody = (body: unknown): CreateAccountRequest | null => {
  if (!isRecord(body)) {
    return null;
  }
  const keys = Object.keys(body).sort();
  if (keys.join(',') !== 'currency,ledger_id,name,side') {
    return null;
  }
  if (
    !isUuid(body.ledger_id) ||
    !isNonEmptyTrimmed(body.name) ||
    !isNonEmptyTrimmed(body.currency) ||
    (body.side !== 'DEBIT' && body.side !== 'CREDIT')
  ) {
    return null;
  }
  return {
    ledger_id: body.ledger_id,
    name: body.name,
    side: body.side,
    currency: body.currency,
  };
};

const parseCreateTransactionBody = (body: unknown): CreateTransactionRequest | null => {
  if (!isRecord(body)) {
    return null;
  }
  const keys = Object.keys(body).sort();
  const validShape =
    keys.join(',') === 'currency,description,entries,ledger_id,reference' ||
    keys.join(',') === 'currency,entries,ledger_id,reference';
  if (!validShape) {
    return null;
  }
  if (
    !isUuid(body.ledger_id) ||
    !isNonEmptyTrimmed(body.reference) ||
    !isNonEmptyTrimmed(body.currency) ||
    !Array.isArray(body.entries) ||
    body.entries.length < 2
  ) {
    return null;
  }
  if (body.description !== undefined && !isNonEmptyTrimmed(body.description)) {
    return null;
  }

  for (const entry of body.entries) {
    if (!isRecord(entry)) {
      return null;
    }
    const entryKeys = Object.keys(entry).sort();
    if (entryKeys.join(',') !== 'account_id,amount_minor,currency,direction') {
      return null;
    }
    if (
      !isUuid(entry.account_id) ||
      (entry.direction !== 'DEBIT' && entry.direction !== 'CREDIT') ||
      typeof entry.amount_minor !== 'string' ||
      !POSITIVE_INT_STRING_PATTERN.test(entry.amount_minor) ||
      !isNonEmptyTrimmed(entry.currency)
    ) {
      return null;
    }
  }

  return body as CreateTransactionRequest;
};

const parseCreateApiKeyBody = (body: unknown): CreateApiKeyRequest | null => {
  if (!isRecord(body)) {
    return null;
  }
  const keys = Object.keys(body).sort();
  if (keys.join(',') !== 'name,role') {
    return null;
  }
  if (!isNonEmptyTrimmed(body.name) || (body.role !== ApiKeyRole.ADMIN && body.role !== ApiKeyRole.SERVICE)) {
    return null;
  }
  return { name: body.name, role: body.role };
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

export const registerLedgerExpressAdapter = (
  app: Application,
  dependencies: ExpressLedgerAdapterDependencies,
): void => {
  ensureJsonMiddleware(app);

  app.post('/v1/ledgers', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = parseCreateLedgerBody(req.body);
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
      const response: TrialBalanceResponse = {
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
      };
      res.status(200).json(response);
    }),
  );

  app.post('/v1/transactions', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = parseCreateTransactionBody(req.body);
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
      const body = parseCreateAccountBody(req.body);
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
      const body = parseCreateApiKeyBody(req.body);
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

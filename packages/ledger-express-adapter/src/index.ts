import { AccountSide } from '@lux/ledger';
import {
  type ApplicationServices,
  ForbiddenError,
  UnauthorizedError,
} from '@lux/ledger/application';
import {
  type AccountByIdParams,
  ApiKeyRole,
  type BalanceAsOfQuery,
  type BalanceAsOfResponse,
  type BalanceHistoryQuery,
  type BalanceHistoryResponse,
  type BulkCreateTransactionRequest,
  type BulkCreateTransactionResponse,
  balanceAsOfQuerySchema,
  balanceHistoryQuerySchema,
  bulkCreateTransactionRequestSchema,
  type CommitHoldRequest,
  type CommitHoldResponse,
  type CorrectTransactionRequest,
  type CorrectTransactionResponse,
  type CreateAccountRequest,
  type CreateApiKeyRequest,
  type CreateHoldRequest,
  type CreateHoldResponse,
  type CreateLedgerRequest,
  type CreateReconRuleRequest,
  type CreateTransactionRequest,
  type CreateTransactionResponse,
  commitHoldRequestSchema,
  correctTransactionRequestSchema,
  createAccountBodySchema,
  createApiKeyBodySchema,
  createHoldRequestSchema,
  createLedgerBodySchema,
  createReconRuleRequestSchema,
  createTransactionRequestSchema,
  type HoldByIdParams,
  type IngestReconRecordsRequest,
  ingestReconRecordsRequestSchema,
  type LedgerByIdParams,
  type ListAccountsQuery,
  type ListEntriesQuery,
  type ListTransactionsQuery,
  type ReconRuleResponse,
  type ReconRulesListResponse,
  type ReconRunByIdParams,
  type ReconRunResponse,
  type ReconUploadResponse,
  type ReverseTransactionRequest,
  type ReverseTransactionResponse,
  type RevokeApiKeyParams,
  type RunReconRequest,
  reverseTransactionRequestSchema,
  runReconRequestSchema,
  type TransactionByIdParams,
  type TransactionsPage,
  type TrialBalanceParams,
  type VoidHoldResponse,
} from '@lux/ledger-http/contracts';
import { invalidInputPayload, toHttpErrorPayload } from '@lux/ledger-http/errors';
import {
  toAccountResponse,
  toApiKeyContract,
  toEntryResponse,
  toReconRuleResponse,
  toReconRunResponse,
  toReconUploadResponse,
  toTransactionResponse,
  toTrialBalanceResponse,
} from '@lux/ledger-http/mappers';
import {
  parseCursorQuery,
  parseLimitQuery,
  parseUuidQuery,
} from '@lux/ledger-http/query/pagination';
import { withErrorHandling } from '@lux/ledger-http/route-core';
import { parseUuidParam } from '@lux/ledger-http/validation-utils';
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
  services: ApplicationServices;
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
    ...(payload.details === undefined ? {} : { details: payload.details }),
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
      const ledger = await dependencies.services.ledgers.create({
        tenantId: context.tenantId,
        name: body.name,
      });
      res.status(201).json(ledger);
    }),
  );

  app.get('/v1/ledgers', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const context = requireContext(req);
      const ledgers = await dependencies.services.ledgers.list(context.tenantId);
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
      const ledger = await dependencies.services.ledgers.getById(context.tenantId, params.id);
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
      const trialBalance = await dependencies.services.balances.getTrialBalance({
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
      const result = await dependencies.services.transactions.create({
        tenantId: context.tenantId,
        ledgerId: body.ledger_id,
        reference: body.reference,
        currency: body.currency,
        description: body.description,
        effectiveAt: body.effective_at === undefined ? undefined : new Date(body.effective_at),
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

  app.post('/v1/transactions/bulk', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<BulkCreateTransactionRequest>(
        bulkCreateTransactionRequestSchema,
        req.body,
      );
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const result = await dependencies.services.transactions.createBulk({
        tenantId: context.tenantId,
        transactions: body.transactions.map((transaction) => ({
          tenantId: context.tenantId,
          ledgerId: transaction.ledger_id,
          reference: transaction.reference,
          currency: transaction.currency,
          description: transaction.description,
          effectiveAt:
            transaction.effective_at === undefined ? undefined : new Date(transaction.effective_at),
          entries: transaction.entries.map((entry) => ({
            accountId: entry.account_id,
            direction: entry.direction,
            amountMinor: BigInt(entry.amount_minor),
            currency: entry.currency,
          })),
        })),
      });
      const response: BulkCreateTransactionResponse = {
        created_count: result.createdCount,
        idempotent_count: result.idempotentCount,
        transactions: result.transactions.map((transaction) => ({
          reference: transaction.reference,
          transaction_id: transaction.transactionId,
          created: transaction.created,
        })),
      };
      res.status(result.createdCount > 0 ? 201 : 200).json(response);
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
      const transaction = await dependencies.services.transactions.getById(
        context.tenantId,
        params.id,
      );
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
      const page = await dependencies.services.transactions.list({
        tenantId: context.tenantId,
        limit: resolvedLimit,
        cursor: query.cursor,
        ledgerId: query.ledger_id,
      });
      const response: TransactionsPage = {
        data: page.data.map(toTransactionResponse),
        next_cursor: page.nextCursor,
      };
      res.status(200).json(response);
    }),
  );

  app.post('/v1/transactions/:id/reverse', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof TransactionByIdParams>(req.params.id, 'id');
      const body = validate<ReverseTransactionRequest>(reverseTransactionRequestSchema, req.body);
      if (params === null || body === null) {
        sendInvalidInput(res, params === null ? 'Invalid path parameter' : 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const result = await dependencies.services.transactions.reverse({
        tenantId: context.tenantId,
        transactionId: params.id,
        reference: body.reference,
        description: body.description,
      });
      const response: ReverseTransactionResponse = {
        transaction_id: result.transactionId,
        created: result.created,
      };
      res.status(result.created ? 201 : 200).json(response);
    }),
  );

  app.post('/v1/transactions/:id/correct', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof TransactionByIdParams>(req.params.id, 'id');
      const body = validate<CorrectTransactionRequest>(correctTransactionRequestSchema, req.body);
      if (params === null || body === null) {
        sendInvalidInput(res, params === null ? 'Invalid path parameter' : 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const result = await dependencies.services.transactions.correct({
        tenantId: context.tenantId,
        transactionId: params.id,
        reversalReference: body.reversal_reference,
        correctedReference: body.corrected_reference,
        description: body.description,
        entries: body.entries.map((entry) => ({
          accountId: entry.account_id,
          direction: entry.direction,
          amountMinor: BigInt(entry.amount_minor),
          currency: entry.currency,
        })),
      });
      const response: CorrectTransactionResponse = {
        reversal_transaction_id: result.reversalTransactionId,
        corrected_transaction_id: result.correctedTransactionId,
        created: result.created,
      };
      res.status(result.created ? 201 : 200).json(response);
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
      const account = await dependencies.services.accounts.create({
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
      const account = await dependencies.services.accounts.getById(context.tenantId, params.id);
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
      const page = await dependencies.services.accounts.list({
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

  app.get('/v1/accounts/:id/balance-as-of', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof AccountByIdParams>(req.params.id, 'id');
      const query = validate<BalanceAsOfQuery>(balanceAsOfQuerySchema, req.query);
      if (params === null || query === null) {
        sendInvalidInput(res, params === null ? 'Invalid path parameter' : 'Invalid querystring');
        return;
      }
      const context = requireContext(req);
      const result = await dependencies.services.balances.getAt({
        tenantId: context.tenantId,
        accountId: params.id,
        at: new Date(query.at),
      });
      const response: BalanceAsOfResponse = {
        account_id: result.accountId,
        timestamp: result.at.toISOString(),
        posted_minor: result.postedMinor.toString(),
        inflight_debit_minor: result.inflightDebitMinor.toString(),
        inflight_credit_minor: result.inflightCreditMinor.toString(),
        available_minor: result.availableMinor.toString(),
      };
      res.status(200).json(response);
    }),
  );

  app.get('/v1/accounts/:id/balance-history', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof AccountByIdParams>(req.params.id, 'id');
      const limit = parseLimitQuery(req.query.limit);
      const cursor = parseCursorQuery(req.query.cursor);
      const query = validate<BalanceHistoryQuery>(balanceHistoryQuerySchema, {
        from: req.query.from,
        to: req.query.to,
        limit,
        ...(cursor === null ? {} : { cursor }),
      });
      if (
        params === null ||
        limit === null ||
        (req.query.cursor !== undefined && cursor === null) ||
        query === null
      ) {
        sendInvalidInput(res, params === null ? 'Invalid path parameter' : 'Invalid querystring');
        return;
      }
      const context = requireContext(req);
      const page = await dependencies.services.balances.listHistory({
        tenantId: context.tenantId,
        accountId: params.id,
        from: new Date(query.from),
        to: new Date(query.to),
        limit,
        cursor: cursor ?? undefined,
      });
      const response: BalanceHistoryResponse = {
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
      };
      res.status(200).json(response);
    }),
  );

  app.post('/v1/holds', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<CreateHoldRequest>(createHoldRequestSchema, req.body);
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const result = await dependencies.services.holds.create({
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
      const response: CreateHoldResponse = {
        hold_id: result.holdId,
        created: result.created,
        state: result.state,
        remaining_amount_minor: result.remainingAmountMinor.toString(),
      };
      res.status(result.created ? 201 : 200).json(response);
    }),
  );

  app.post('/v1/holds/:id/commit', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof HoldByIdParams>(req.params.id, 'id');
      const body = validate<CommitHoldRequest>(commitHoldRequestSchema, req.body);
      if (params === null || body === null) {
        sendInvalidInput(res, params === null ? 'Invalid path parameter' : 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const result = await dependencies.services.holds.commit({
        tenantId: context.tenantId,
        holdId: params.id,
        reference: body.reference,
        amountMinor: body.amount_minor === undefined ? undefined : BigInt(body.amount_minor),
      });
      const response: CommitHoldResponse = {
        hold_id: result.holdId,
        transaction_id: result.transactionId,
        created: result.created,
        state: result.state,
        remaining_amount_minor: result.remainingAmountMinor.toString(),
      };
      res.status(result.created ? 201 : 200).json(response);
    }),
  );

  app.post('/v1/holds/:id/void', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof HoldByIdParams>(req.params.id, 'id');
      if (params === null) {
        sendInvalidInput(res, 'Invalid path parameter');
        return;
      }
      const context = requireContext(req);
      const result = await dependencies.services.holds.void({
        tenantId: context.tenantId,
        holdId: params.id,
      });
      const response: VoidHoldResponse = {
        hold_id: result.holdId,
        state: result.state,
        voided: result.voided,
        remaining_amount_minor: result.remainingAmountMinor.toString(),
      };
      res.status(200).json(response);
    }),
  );

  app.post('/v1/reconciliation/matching-rules', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<CreateReconRuleRequest>(createReconRuleRequestSchema, req.body);
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const rule = await dependencies.services.reconciliation.createRule({
        tenantId: context.tenantId,
        name: body.name,
        description: body.description,
        criteria: body.criteria.map((criterion) => ({
          field: criterion.field,
          operator: criterion.operator,
          amountToleranceMinor:
            criterion.amount_tolerance_minor === undefined
              ? undefined
              : BigInt(criterion.amount_tolerance_minor),
          dateToleranceSeconds: criterion.date_tolerance_seconds,
        })),
      });
      const response: ReconRuleResponse = toReconRuleResponse(rule);
      res.status(201).json(response);
    }),
  );

  app.get('/v1/reconciliation/matching-rules', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const context = requireContext(req);
      const rules = await dependencies.services.reconciliation.listRules(context.tenantId);
      const response: ReconRulesListResponse = {
        data: rules.map(toReconRuleResponse),
      };
      res.status(200).json(response);
    }),
  );

  app.post('/v1/reconciliation/external-records', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<IngestReconRecordsRequest>(ingestReconRecordsRequestSchema, req.body);
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const upload = await dependencies.services.reconciliation.ingest({
        tenantId: context.tenantId,
        source: body.source,
        records: body.records.map((record) => ({
          externalId: record.id,
          amountMinor: BigInt(record.amount_minor),
          currency: record.currency,
          reference: record.reference,
          description: record.description ?? null,
          occurredAt: new Date(record.date),
          raw: record.raw ?? null,
        })),
      });
      const response: ReconUploadResponse = toReconUploadResponse(upload);
      res.status(201).json(response);
    }),
  );

  app.post('/v1/reconciliation/runs', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<RunReconRequest>(runReconRequestSchema, req.body);
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const run = await dependencies.services.reconciliation.run({
        tenantId: context.tenantId,
        ledgerId: body.ledger_id,
        uploadId: body.upload_id,
        strategy: body.strategy,
        matchingRuleIds: body.matching_rule_ids,
        dryRun: body.dry_run,
      });
      const response: ReconRunResponse = toReconRunResponse(run);
      res.status(body.dry_run ? 200 : 201).json(response);
    }),
  );

  app.get('/v1/reconciliation/runs/:id', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof ReconRunByIdParams>(req.params.id, 'id');
      if (params === null) {
        sendInvalidInput(res, 'Invalid path parameter');
        return;
      }
      const context = requireContext(req);
      const run = await dependencies.services.reconciliation.getRun(context.tenantId, params.id);
      const response: ReconRunResponse = toReconRunResponse(run);
      res.status(200).json(response);
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
      const page = await dependencies.services.transactions.listEntries({
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
      const keys = await dependencies.services.apiKeys.listApiKeys({
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
      const created = await dependencies.services.apiKeys.createApiKey(
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
      await dependencies.services.apiKeys.revokeApiKey(
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

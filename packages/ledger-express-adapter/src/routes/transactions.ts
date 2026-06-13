import type { ApplicationServices } from '@lux/ledger/application';
import {
  type BulkCreateTransactionRequest,
  type BulkCreateTransactionResponse,
  bulkCreateTransactionRequestSchema,
  type CorrectTransactionRequest,
  type CorrectTransactionResponse,
  type CreateTransactionRequest,
  type CreateTransactionResponse,
  correctTransactionRequestSchema,
  createTransactionRequestSchema,
  type ListTransactionsQuery,
  type ReverseTransactionRequest,
  type ReverseTransactionResponse,
  reverseTransactionRequestSchema,
  type TransactionByIdParams,
  type TransactionsPage,
} from '@lux/ledger-http/contracts';
import { toTransactionResponse } from '@lux/ledger-http/mappers';
import { parseUuidQuery } from '@lux/ledger-http/query/pagination';
import { parseUuidParam } from '@lux/ledger-http/validation-utils';
import type { Application, Response } from 'express';
import { sendInvalidInput, withDomainErrorHandling } from '../errors/handlers';
import { parsePaginationQuery } from '../query/pagination';
import { requireContext } from '../request/context';
import { validate } from '../request/validation';
import type { RequestWithContext } from '../types';

type TransactionRouteServices = Pick<ApplicationServices, 'transactions'>;

export const registerTransactionRoutes = (
  app: Application,
  services: TransactionRouteServices,
): void => {
  app.post('/v1/transactions', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<CreateTransactionRequest>(createTransactionRequestSchema, req.body);
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const result = await services.transactions.create({
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
      const result = await services.transactions.createBulk({
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
      const transaction = await services.transactions.getById(context.tenantId, params.id);
      res.status(200).json(toTransactionResponse(transaction));
    }),
  );

  app.get('/v1/transactions', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const pagination = parsePaginationQuery(req.query);
      const ledgerId = parseUuidQuery(req.query.ledger_id);
      if (pagination === null) {
        sendInvalidInput(res, 'Invalid querystring');
        return;
      }
      if (req.query.ledger_id !== undefined && ledgerId === null) {
        sendInvalidInput(res, 'Invalid querystring');
        return;
      }
      const query: ListTransactionsQuery = {
        limit: pagination.limit,
        cursor: pagination.cursor,
        ledger_id: ledgerId ?? undefined,
      };
      const context = requireContext(req);
      const page = await services.transactions.list({
        tenantId: context.tenantId,
        limit: pagination.limit,
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
      const result = await services.transactions.reverse({
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
      const result = await services.transactions.correct({
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
};

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ApiKeyRole, type ApiKeyService, type LedgerService } from '@lux/ledger/application';
import { registerLedgerAdapter as registerFastifyLedgerAdapter } from '@lux/ledger-fastify-adapter';
import { createContractHarness } from '@lux/ledger-http/test/harness';
import express, { type Application } from 'express';
import Fastify, { type FastifyInstance } from 'fastify';
import httpMocks from 'node-mocks-http';
import { registerLedgerAdapter as registerExpressLedgerAdapter } from './index';

type RequestResult = {
  status: number;
  json: unknown;
};

const tenantId = '11111111-1111-4111-8111-111111111111';

class FakeLedgerService {
  private txByReference = new Map<string, string>();

  public async getLedgersByTenant(_tenantId: string): Promise<unknown[]> {
    return [];
  }

  public async createTransaction(input: {
    tenantId: string;
    reference: string;
  }): Promise<{ transactionId: string; created: boolean }> {
    const key = `${input.tenantId}:${input.reference}`;
    const existing = this.txByReference.get(key);
    if (existing) {
      return { transactionId: existing, created: false };
    }
    const id = '00000000-0000-4000-8000-000000000300';
    this.txByReference.set(key, id);
    return { transactionId: id, created: true };
  }

  public async createTransactionsBulk(input: {
    tenantId: string;
    transactions: Array<{ reference: string }>;
  }) {
    const transactions = [];
    for (const transaction of input.transactions) {
      const result = await this.createTransaction({
        tenantId: input.tenantId,
        reference: transaction.reference,
      });
      transactions.push({
        reference: transaction.reference,
        transactionId: result.transactionId,
        created: result.created,
      });
    }
    return {
      createdCount: transactions.filter((transaction) => transaction.created).length,
      idempotentCount: transactions.filter((transaction) => !transaction.created).length,
      transactions,
    };
  }
}

class FakeApiKeyService {
  public async listApiKeys(): Promise<unknown[]> {
    return [];
  }
}

describe('express adapter parity with fastify adapter', () => {
  let fastifyServer: FastifyInstance;
  let expressApp: Application;

  beforeAll(async () => {
    const ledgerService = new FakeLedgerService() as unknown as LedgerService;
    const apiKeyService = new FakeApiKeyService() as unknown as ApiKeyService;

    fastifyServer = Fastify({
      ajv: {
        customOptions: {
          removeAdditional: false,
        },
      },
    });
    fastifyServer.decorateRequest('tenantId');
    fastifyServer.decorateRequest('apiKeyId');
    fastifyServer.decorateRequest('apiKeyRole');
    fastifyServer.addHook('onRequest', async (request) => {
      (request as { tenantId?: string }).tenantId = tenantId;
      (request as { apiKeyId?: string }).apiKeyId = '00000000-0000-4000-8000-000000000001';
      (request as { apiKeyRole?: ApiKeyRole }).apiKeyRole = ApiKeyRole.ADMIN;
    });
    fastifyServer.setErrorHandler((error, _request, reply) => {
      if (
        typeof error === 'object' &&
        error !== null &&
        'validation' in error &&
        'message' in error &&
        typeof (error as { message: unknown }).message === 'string'
      ) {
        reply.status(400).send({
          error: 'INVALID_INPUT',
          message: (error as { message: string }).message,
        });
        return;
      }
      reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    });
    registerFastifyLedgerAdapter(fastifyServer, { ledgerService, apiKeyService });

    expressApp = express();
    expressApp.use(express.json());
    expressApp.use((req, _res, next) => {
      (req as { tenantId?: string }).tenantId = tenantId;
      (req as { apiKeyId?: string }).apiKeyId = '00000000-0000-4000-8000-000000000001';
      (req as { apiKeyRole?: ApiKeyRole }).apiKeyRole = ApiKeyRole.ADMIN;
      next();
    });
    registerExpressLedgerAdapter(expressApp, { ledgerService, apiKeyService });
  });

  afterAll(async () => {
    await fastifyServer.close();
  });

  const requestFastify = async (
    method: 'GET' | 'POST',
    url: string,
    payload?: unknown,
  ): Promise<RequestResult> => {
    const response = (await fastifyServer.inject({
      method,
      url,
      payload: payload as Record<string, unknown> | undefined,
    })) as { statusCode: number; body: unknown };
    const textBody =
      typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
    return {
      status: response.statusCode,
      json: textBody.length > 0 ? JSON.parse(textBody) : null,
    };
  };

  const requestExpress = async (
    method: 'GET' | 'POST',
    url: string,
    payload?: unknown,
  ): Promise<RequestResult> => {
    const req = httpMocks.createRequest({
      method,
      url,
      body: payload as object | undefined,
      headers: {
        'content-type': 'application/json',
      },
    }) as unknown as { tenantId?: string; apiKeyId?: string; apiKeyRole?: ApiKeyRole };
    req.tenantId = tenantId;
    req.apiKeyId = '00000000-0000-4000-8000-000000000001';
    req.apiKeyRole = ApiKeyRole.ADMIN;

    const res = httpMocks.createResponse({
      eventEmitter: (await import('node:events')).EventEmitter,
    });

    await new Promise<void>((resolve) => {
      (expressApp as unknown as (req: unknown, res: unknown, next: () => void) => void)(
        req,
        res,
        () => resolve(),
      );
      if (res.writableEnded) {
        resolve();
      } else {
        res.on('finish', () => resolve());
      }
    });

    const responseText = res._getData() as string;
    return {
      status: res.statusCode,
      json: responseText.length > 0 ? JSON.parse(responseText) : null,
    };
  };

  it('reuses framework-agnostic harness runners and keeps focused parity', async () => {
    const harness = createContractHarness();
    harness.runForAdapters(
      [{ name: 'fastify' }, { name: 'express' }],
      [{ name: 'runner smoke', assert: () => expect(true).toBeTrue() }],
    );

    const checks = [
      {
        name: 'GET /v1/ledgers parity',
        run: async () => {
          const [fastifyResponse, expressResponse] = await Promise.all([
            requestFastify('GET', '/v1/ledgers'),
            requestExpress('GET', '/v1/ledgers'),
          ]);
          expect(expressResponse.status).toBe(fastifyResponse.status);
          expect(expressResponse.json).toEqual(fastifyResponse.json);
        },
      },
      {
        name: 'POST /v1/accounts validation error parity',
        run: async () => {
          const payload = {
            name: 'Invalid account payload',
            side: 'DEBIT',
            currency: 'USD',
          };
          const [fastifyResponse, expressResponse] = await Promise.all([
            requestFastify('POST', '/v1/accounts', payload),
            requestExpress('POST', '/v1/accounts', payload),
          ]);
          expect(expressResponse.status).toBe(400);
          expect(fastifyResponse.status).toBe(400);
          expect(expressResponse.json).toEqual(
            expect.objectContaining({
              error: 'INVALID_INPUT',
            }),
          );
          expect(fastifyResponse.json).toEqual(
            expect.objectContaining({
              error: 'INVALID_INPUT',
            }),
          );
        },
      },
      {
        name: 'POST /v1/transactions idempotency status parity',
        run: async () => {
          const buildPayload = (reference: string) => ({
            ledger_id: '00000000-0000-4000-8000-000000000001',
            reference,
            currency: 'USD',
            entries: [
              {
                account_id: '00000000-0000-4000-8000-000000000101',
                direction: 'DEBIT',
                amount_minor: '100',
                currency: 'USD',
              },
              {
                account_id: '00000000-0000-4000-8000-000000000102',
                direction: 'CREDIT',
                amount_minor: '100',
                currency: 'USD',
              },
            ],
          });

          const firstFastify = await requestFastify(
            'POST',
            '/v1/transactions',
            buildPayload('parity-ref-fastify'),
          );
          const firstExpress = await requestExpress(
            'POST',
            '/v1/transactions',
            buildPayload('parity-ref-express'),
          );
          expect(firstFastify.status).toBe(201);
          expect(firstExpress.status).toBe(201);

          const secondFastify = await requestFastify(
            'POST',
            '/v1/transactions',
            buildPayload('parity-ref-fastify'),
          );
          const secondExpress = await requestExpress(
            'POST',
            '/v1/transactions',
            buildPayload('parity-ref-express'),
          );
          expect(secondFastify.status).toBe(200);
          expect(secondExpress.status).toBe(200);
          expect(secondFastify.json).toEqual(
            expect.objectContaining({
              created: false,
            }),
          );
          expect(secondExpress.json).toEqual(
            expect.objectContaining({
              created: false,
            }),
          );
        },
      },
    ];

    for (const check of checks) {
      await check.run();
    }
  });
});

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CREDIT_LOT_MOVEMENT_KINDS } from '@luxledger/core/application';
import Ajv from 'ajv';
import {
  reconResultResponseSchema,
  reconResultsListQuerySchema,
  reconResultsListResponseSchema,
} from '../contracts/reconciliation';
import {
  accountResponseSchema,
  accountStatementResponseSchema,
  adjustmentResponseSchema,
  createAccountBodySchema,
  createAdjustmentBodySchema,
  createApiKeyBodySchema,
  createCreditGrantBodySchema,
  createLedgerBodySchema,
  createTransactionRequestSchema,
  creditBalanceResponseSchema,
  creditGrantLotResponseSchema,
  creditGrantResponseSchema,
  creditLotStatementResponseSchema,
  entriesPageResponseSchema,
  refundCreditGrantBodySchema,
  refundCreditGrantResponseSchema,
  transactionEntryRequestSchema,
  transactionResponseSchema,
} from '../index';
import type { FilterFields } from '../query/list-filter';
import { parseWhere, whereFieldsToJsonSchema, whereQueryProperty } from '../query/list-filter';
import {
  accountFilterFields,
  apiKeyFilterFields,
  balanceHistoryFilterFields,
  creditGrantFilterFields,
  creditLineageFilterFields,
  entryFilterFields,
  ledgerFilterFields,
  reconResultListFilterFields,
  reconRuleFilterFields,
  transactionFilterFields,
} from '../query/list-filter-fields';
import { createContractHarness } from './harness';

const openapiPath = resolve(import.meta.dir, '../../openapi/openapi.yaml');

type OpenApiSchema = {
  additionalProperties?: boolean;
  required?: readonly string[];
  properties?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

type OpenApiContent = {
  content?: {
    'application/json'?: {
      schema?: { $ref?: string };
      example?: unknown;
    };
  };
};

type OpenApiOperation = {
  requestBody?: OpenApiContent & { required?: boolean };
  responses?: Record<string, OpenApiContent & { $ref?: string; description?: string }>;
};

type OpenApiDocument = {
  components?: { schemas?: Record<string, OpenApiSchema> };
  paths?: Record<
    string,
    {
      post?: OpenApiOperation;
      get?: OpenApiOperation & { parameters?: Array<Record<string, unknown>> };
    }
  >;
};

describe('framework-agnostic contract suite', () => {
  it('keeps core request/response schemas deterministic', () => {
    const harness = createContractHarness();
    const adapters = [{ name: 'fastify' }, { name: 'express' }] as const;

    harness.runForAdapters(
      [...adapters],
      [
        {
          name: 'create transaction required fields',
          assert: () =>
            expect(createTransactionRequestSchema.required).toEqual([
              'ledger_id',
              'reference',
              'currency',
              'entries',
            ]),
        },
        {
          name: 'account response contains balance_minor as string',
          assert: () =>
            expect(accountResponseSchema.properties.balance_minor).toEqual({ type: 'string' }),
        },
        {
          name: 'account response keeps code nullable',
          assert: () =>
            expect(accountResponseSchema.properties.code).toEqual({
              type: 'string',
              nullable: true,
            }),
        },
        {
          name: 'entries response keeps nullable cursor',
          assert: () =>
            expect(entriesPageResponseSchema.properties.next_cursor).toEqual({
              type: 'string',
              nullable: true,
            }),
        },
        {
          name: 'api key payload requires name and role',
          assert: () => expect(createApiKeyBodySchema.required).toEqual(['name', 'role']),
        },
        {
          name: 'ledger request requires only name',
          assert: () => expect(createLedgerBodySchema.required).toEqual(['name']),
        },
        {
          name: 'transaction response keeps nullable description',
          assert: () =>
            expect(transactionResponseSchema.properties.description).toEqual({
              type: 'string',
              nullable: true,
            }),
        },
        {
          name: 'transaction metadata is optional on input and required nullable on output',
          assert: () => {
            expect(createTransactionRequestSchema.required).not.toContain('metadata');
            expect(createTransactionRequestSchema.properties.metadata).toEqual({
              type: 'object',
              additionalProperties: true,
            });
            expect(transactionResponseSchema.required).toContain('metadata');
            expect(transactionResponseSchema.properties.metadata).toEqual({
              type: 'object',
              additionalProperties: true,
              nullable: true,
            });
          },
        },
        {
          name: 'account request forbids additional properties',
          assert: () => expect(createAccountBodySchema.additionalProperties).toBeFalse(),
        },
        {
          name: 'account grant capability is optional on creation and required on reads',
          assert: () => {
            expect(createAccountBodySchema.required).not.toContain('grant_enabled');
            expect(createAccountBodySchema.properties.grant_enabled).toEqual({
              type: 'boolean',
              default: false,
            });
            expect(accountResponseSchema.required).toContain('grant_enabled');
            expect(accountResponseSchema.properties.grant_enabled).toEqual({ type: 'boolean' });
          },
        },
        {
          name: 'grant derives its asset from the account and uses integer minor units',
          assert: () => {
            expect(createCreditGrantBodySchema.required).not.toContain('asset_id');
            expect(createCreditGrantBodySchema.required).toEqual([
              'ledger_id',
              'account_id',
              'funding_account_id',
              'reference',
              'amount_minor',
            ]);
            expect(createCreditGrantBodySchema.properties.amount_minor).toEqual({
              type: 'string',
              pattern: '^[1-9][0-9]*$',
            });
            const responseAmount = { type: 'string', pattern: '^[0-9]+$' } as const;
            expect(creditGrantResponseSchema.properties.amount_minor).toEqual(responseAmount);
            expect(creditGrantLotResponseSchema.properties.granted_minor).toEqual(responseAmount);
            expect(creditGrantLotResponseSchema.properties.reversed_minor).toEqual(responseAmount);
            expect(creditGrantLotResponseSchema.properties.expired_minor).toEqual(responseAmount);
            expect(creditGrantLotResponseSchema.properties.remaining_minor).toEqual(responseAmount);
            expect(creditGrantResponseSchema.required).toContain('expires_at');
            expect(creditBalanceResponseSchema.properties.ledger_balance_minor).toEqual(
              responseAmount,
            );
            expect(creditBalanceResponseSchema.properties.remaining_minor).toEqual(responseAmount);
            expect(creditBalanceResponseSchema.required).toContain('ledger_balance_minor');
          },
        },
        {
          name: 'statement responses are bounded and expose reconciling summaries',
          assert: () => {
            expect(accountStatementResponseSchema.required).toEqual([
              'account_id',
              'asset_id',
              'from',
              'as_of',
              'opening',
              'closing',
              'data',
              'next_cursor',
            ]);
            expect(accountStatementResponseSchema.description).toContain('Across all cursor pages');
            expect(accountStatementResponseSchema.properties.data.description).toContain(
              '(effective_at, id)',
            );
            expect(accountStatementResponseSchema.properties.next_cursor.description).toContain(
              'tenant, account, from, and as_of',
            );
            expect(creditLotStatementResponseSchema.required).toContain('opening_available_minor');
            expect(creditLotStatementResponseSchema.required).toContain('closing_available_minor');
            expect(creditLotStatementResponseSchema.properties.data.type).toBe('array');
            expect(creditLotStatementResponseSchema.properties.data.description).toContain(
              '(created_at, id)',
            );
            expect(
              creditLotStatementResponseSchema.properties.data.items.properties.kind.enum,
            ).toEqual(CREDIT_LOT_MOVEMENT_KINDS);
            expect(
              creditLotStatementResponseSchema.properties.data.items.properties.effective_at
                .description,
            ).toContain('creation time');
          },
        },
      ],
    );
  });

  it('keeps negative validation and nullability semantics deterministic', () => {
    const harness = createContractHarness();

    harness.run([
      {
        name: 'transaction description is optional but not nullable',
        assert: () => {
          expect(createTransactionRequestSchema.required).not.toContain('description');
          expect(
            (createTransactionRequestSchema.properties.description as { nullable?: boolean })
              .nullable,
          ).toBeUndefined();
        },
      },
      {
        name: 'transaction signed amount pattern accepts either nonzero sign',
        assert: () =>
          expect(transactionEntryRequestSchema.properties.signed_amount_minor).toEqual({
            type: 'string',
            pattern: '^-?[1-9][0-9]*$',
          }),
      },
      {
        name: 'account side is restricted to debit/credit',
        assert: () =>
          expect(createAccountBodySchema.properties.side).toEqual({
            type: 'string',
            enum: ['DEBIT', 'CREDIT'],
          }),
      },
      {
        name: 'account code is optional but not nullable on input',
        assert: () => {
          expect(createAccountBodySchema.required).not.toContain('code');
          expect(createAccountBodySchema.properties.code).toEqual({
            type: 'string',
            pattern: '^(?=.*\\S).+$',
          });
          expect(
            (createAccountBodySchema.properties.code as { nullable?: boolean }).nullable,
          ).toBeUndefined();
          expect(accountResponseSchema.required).toContain('code');
        },
      },
      {
        name: 'refund requires a reference and a positive integer amount',
        assert: () => {
          expect(refundCreditGrantBodySchema.required).toEqual(['reference', 'amount_minor']);
          expect(refundCreditGrantBodySchema.properties.amount_minor).toEqual({
            type: 'string',
            pattern: '^[1-9][0-9]*$',
          });
          expect(refundCreditGrantBodySchema.additionalProperties).toBeFalse();
        },
      },
      {
        name: 'adjustment requires audit fields and keeps attributes optional',
        assert: () => {
          expect(createAdjustmentBodySchema.required).toEqual([
            'ledger_id',
            'account_id',
            'offset_account_id',
            'reference',
            'amount_minor',
            'description',
            'reason_code',
            'actor_id',
          ]);
          expect(createAdjustmentBodySchema.required).not.toContain('attributes');
          expect(createAdjustmentBodySchema.additionalProperties).toBeFalse();
        },
      },
      {
        name: 'api key payload forbids additional properties',
        assert: () => expect(createApiKeyBodySchema.additionalProperties).toBeFalse(),
      },
    ]);
  });

  it('stays aligned with openapi source for migrated endpoints', () => {
    const openapi = readFileSync(openapiPath, 'utf8');
    const openapiDocument = Bun.YAML.parse(openapi) as OpenApiDocument;
    expect(openapi).toContain('/v1/transactions:');
    expect(openapi).toContain('/v1/accounts:');
    expect(openapi).toContain('/v1/admin/api-keys:');
    expect(openapi).toContain('/v1/ledgers:');
    expect(openapi).toContain('/v1/entries:');
    expect(openapi).toContain('required: [ledger_id, reference, currency, entries]');
    expect(openapi).toContain(
      'required: [id, tenant_id, ledger_id, reference, currency, description, metadata, related_transaction_id, relation_type, effective_at, created_at]',
    );
    expect(openapi).toContain(
      'description: Optional JSON object with caller-defined transaction metadata. Null, arrays, and primitives are rejected.',
    );
    const openapiCreateAccount = openapiDocument.components?.schemas?.CreateAccountRequest;
    const openapiAccount = openapiDocument.components?.schemas?.Account;
    expect(openapiCreateAccount?.additionalProperties).toBe(
      createAccountBodySchema.additionalProperties,
    );
    expect(openapiCreateAccount?.required).toEqual([...createAccountBodySchema.required]);
    expect(openapiCreateAccount?.properties?.grant_enabled).toMatchObject(
      createAccountBodySchema.properties.grant_enabled,
    );
    expect(openapiAccount?.required).toEqual([...accountResponseSchema.required]);
    expect(openapiAccount?.properties?.grant_enabled).toMatchObject(
      accountResponseSchema.properties.grant_enabled,
    );
    expect(openapi).toContain('CreateApiKeyRequest:');
    expect(openapi).toContain('/v1/credit-grants:');
    expect(openapi).toContain('/v1/accounts/{id}/credit-balance:');
    expect(openapi).toContain('CreditGrantLineagePage:');
    expect(openapi).toContain('CreateCreditGrantRequest:');
    expect(openapi).toContain('/v1/credit-grants/{id}/refund:');
    expect(openapi).toContain('/v1/adjustments/credit:');
    expect(openapi).toContain('/v1/adjustments/debit:');
    expect(openapi).toContain('RefundCreditGrantRequest:');
    expect(openapi).toContain('CreateAdjustmentRequest:');
    expect(openapi).toContain('/v1/accounts/{id}/statement:');
    expect(openapi).toContain('/v1/accounts/{id}/credit-statement:');
    expect(openapi).toContain('AccountStatement:');
    expect(openapi).toContain('CreditLotStatement:');
    expect(openapi).toContain(`enum: [${CREDIT_LOT_MOVEMENT_KINDS.join(', ')}]`);

    const schemas = openapiDocument.components?.schemas;
    expect(schemas?.RefundCreditGrantRequest).toEqual(refundCreditGrantBodySchema);
    expect(schemas?.CreditGrantRefund).toEqual(refundCreditGrantResponseSchema);
    expect(schemas?.CreateAdjustmentRequest).toEqual(createAdjustmentBodySchema);
    expect(schemas?.Adjustment).toEqual(adjustmentResponseSchema);

    const assertPostContract = (
      path: string,
      requestSchema: string,
      responseSchema: string,
    ): void => {
      const operation = openapiDocument.paths?.[path]?.post;
      expect(operation?.requestBody).toEqual({
        required: true,
        content: {
          'application/json': { schema: { $ref: `#/components/schemas/${requestSchema}` } },
        },
      });
      expect(Object.keys(operation?.responses ?? {}).sort()).toEqual([
        '200',
        '201',
        '400',
        '401',
        '404',
        '409',
      ]);
      for (const status of ['200', '201']) {
        expect(operation?.responses?.[status]).toEqual({
          description: status === '201' ? expect.any(String) : 'Identical retry',
          content: {
            'application/json': { schema: { $ref: `#/components/schemas/${responseSchema}` } },
          },
        });
      }
      for (const [status, response] of [
        ['400', 'BadRequestError'],
        ['401', 'UnauthorizedError'],
        ['404', 'NotFoundError'],
        ['409', 'ConflictError'],
      ] as const) {
        expect(operation?.responses?.[status]).toEqual({
          $ref: `#/components/responses/${response}`,
        });
      }
    };

    assertPostContract(
      '/v1/credit-grants/{id}/refund',
      'RefundCreditGrantRequest',
      'CreditGrantRefund',
    );
    assertPostContract('/v1/adjustments/credit', 'CreateAdjustmentRequest', 'Adjustment');
    assertPostContract('/v1/adjustments/debit', 'CreateAdjustmentRequest', 'Adjustment');
  });

  it('documents typed where parameters on every scoped list operation', () => {
    const document = Bun.YAML.parse(readFileSync(openapiPath, 'utf8')) as OpenApiDocument;
    const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
    const routes: Record<string, [string, FilterFields]> = {
      '/v1/accounts': ['AccountsWhere', accountFilterFields],
      '/v1/transactions': ['TransactionsWhere', transactionFilterFields],
      '/v1/entries': ['EntriesWhere', entryFilterFields],
      '/v1/ledgers': ['LedgersWhere', ledgerFilterFields],
      '/v1/admin/api-keys': ['ApiKeysWhere', apiKeyFilterFields],
      '/v1/reconciliation/matching-rules': ['ReconciliationRulesWhere', reconRuleFilterFields],
      '/v1/reconciliation/runs/{id}/results': [
        'ReconciliationResultsWhere',
        reconResultListFilterFields,
      ],
      '/v1/credit-grants': ['CreditGrantsWhere', creditGrantFilterFields],
      '/v1/credit-grants/{id}/allocations': ['CreditLineageWhere', creditLineageFilterFields],
      '/v1/transactions/{id}/credit-allocations': ['CreditLineageWhere', creditLineageFilterFields],
      '/v1/accounts/{id}/credit-lots': ['CreditGrantsWhere', creditGrantFilterFields],
      '/v1/accounts/{id}/balance-history': ['BalanceHistoryWhere', balanceHistoryFilterFields],
    };
    for (const [path, [schema, fields]] of Object.entries(routes)) {
      const parameters = document.paths?.[path]?.get?.parameters ?? [];
      const where = parameters.find((parameter) => parameter.name === 'where');
      expect(where).toBeDefined();
      expect(where).toMatchObject({
        in: 'query',
        required: false,
        content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } },
      });
      expect(document.components?.schemas?.[schema]).toEqual(whereFieldsToJsonSchema(fields));

      const example =
        where?.content &&
        (where.content as { 'application/json'?: { example?: unknown } })['application/json']
          ?.example;
      expect(example).toBeDefined();
      const validator = ajv.compile(document.components?.schemas?.[schema] as OpenApiSchema);
      expect(validator(example)).toBe(true);
      expect(parseWhere(JSON.stringify(example), fields)).not.toBeNull();
    }

    for (const path of [
      '/v1/ledgers',
      '/v1/admin/api-keys',
      '/v1/reconciliation/matching-rules',
      '/v1/reconciliation/runs/{id}/results',
    ]) {
      expect(document.paths?.[path]?.get?.responses?.['400']).toEqual({
        $ref: '#/components/responses/BadRequestError',
      });
    }

    const resultsPath = '/v1/reconciliation/runs/{id}/results';
    const resultsOperation = document.paths?.[resultsPath]?.get;
    const resultParameters = resultsOperation?.parameters ?? [];
    expect(resultParameters.find((parameter) => parameter.name === 'id')).toMatchObject({
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    });
    expect(resultParameters.find((parameter) => parameter.name === 'limit')).toMatchObject({
      in: 'query',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    });
    expect(resultParameters.find((parameter) => parameter.name === 'cursor')).toMatchObject({
      in: 'query',
      required: false,
      schema: { type: 'string', minLength: 1 },
    });
    const resultsWhere = resultParameters.find((parameter) => parameter.name === 'where');
    expect(
      (resultsWhere?.content as { 'application/json'?: { example?: unknown } } | undefined)?.[
        'application/json'
      ]?.example,
    ).toEqual({ status: { eq: 'conflict' } });
    expect(reconResultsListQuerySchema.properties.where).toEqual(
      whereQueryProperty(reconResultListFilterFields),
    );
    expect(document.components?.schemas?.ReconciliationResultsListResponse).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['data', 'next_cursor'],
      properties: {
        data: { type: 'array', items: { $ref: '#/components/schemas/ReconciliationResult' } },
        next_cursor: { type: 'string', nullable: true },
      },
    });
    expect(reconResultsListResponseSchema.properties.data.items).toEqual(reconResultResponseSchema);
    expect(resultsOperation?.responses?.['200']).toEqual({
      description: expect.any(String),
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ReconciliationResultsListResponse' },
        },
      },
    });
    expect(resultsOperation?.responses?.['404']).toEqual({
      $ref: '#/components/responses/NotFoundError',
    });
    const resultExample = {
      id: '00000000-0000-4000-8000-000000000001',
      run_id: '00000000-0000-4000-8000-000000000002',
      external_record_id: null,
      external_id: null,
      transaction_id: null,
      status: 'unmatched_internal',
      reason: 'no_matching_external_record',
      candidate_transaction_ids: [],
      created_at: '2026-01-01T00:00:00.000Z',
    };
    const resultValidator = new Ajv({ strict: false, validateFormats: false }).compile(
      reconResultResponseSchema,
    );
    expect(resultValidator(resultExample)).toBe(true);
    expect(reconResultsListResponseSchema.properties.data.items).toEqual(reconResultResponseSchema);
  });
});

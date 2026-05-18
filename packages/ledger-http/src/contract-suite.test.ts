import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  accountResponseSchema,
  createAccountBodySchema,
  createApiKeyBodySchema,
  createLedgerBodySchema,
  createTransactionRequestSchema,
  entriesPageResponseSchema,
  transactionEntryRequestSchema,
  transactionResponseSchema,
} from './index';
import { createContractHarness } from './test/harness';

const openapiPath = resolve(import.meta.dir, '../../../apps/luxledger-api/openapi/openapi.yaml');

describe('framework-agnostic contract suite', () => {
  it('keeps core request/response schemas deterministic', () => {
    const harness = createContractHarness();
    const adapters = [{ name: 'fastify' }, { name: 'express' }] as const;

    harness.runForAdapters([...adapters], [
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
        assert: () => expect(accountResponseSchema.properties.balance_minor).toEqual({ type: 'string' }),
      },
      {
        name: 'entries response keeps nullable cursor',
        assert: () => expect(entriesPageResponseSchema.properties.next_cursor).toEqual({ type: 'string', nullable: true }),
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
        assert: () => expect(transactionResponseSchema.properties.description).toEqual({ type: 'string', nullable: true }),
      },
      {
        name: 'account request forbids additional properties',
        assert: () => expect(createAccountBodySchema.additionalProperties).toBeFalse(),
      },
    ]);
  });

  it('keeps negative validation and nullability semantics deterministic', () => {
    const harness = createContractHarness();

    harness.run([
      {
        name: 'transaction description is optional but not nullable',
        assert: () => {
          expect(createTransactionRequestSchema.required).not.toContain('description');
          expect(
            (createTransactionRequestSchema.properties.description as { nullable?: boolean }).nullable,
          ).toBeUndefined();
        },
      },
      {
        name: 'transaction amount pattern rejects zero and negative values',
        assert: () =>
          expect(transactionEntryRequestSchema.properties.amount_minor).toEqual({
            type: 'string',
            pattern: '^[1-9][0-9]*$',
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
        name: 'api key payload forbids additional properties',
        assert: () => expect(createApiKeyBodySchema.additionalProperties).toBeFalse(),
      },
    ]);
  });

  it('stays aligned with openapi source for migrated endpoints', () => {
    const openapi = readFileSync(openapiPath, 'utf8');
    expect(openapi).toContain('/v1/transactions:');
    expect(openapi).toContain('/v1/accounts:');
    expect(openapi).toContain('/v1/admin/api-keys:');
    expect(openapi).toContain('/v1/ledgers:');
    expect(openapi).toContain('/v1/entries:');
    expect(openapi).toContain("required: [ledger_id, reference, currency, entries]");
    expect(openapi).toContain('CreateAccountRequest:');
    expect(openapi).toContain('CreateApiKeyRequest:');
  });
});

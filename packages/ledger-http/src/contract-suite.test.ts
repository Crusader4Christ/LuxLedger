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
  transactionResponseSchema,
} from './index';
import { createContractHarness } from './test/harness';

const openapiPath = resolve(import.meta.dir, '../../../apps/luxledger-api/openapi/openapi.yaml');

describe('framework-agnostic contract suite', () => {
  it('keeps core request/response schemas deterministic', () => {
    const harness = createContractHarness();

    harness.run([
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

  it('stays aligned with openapi source for migrated endpoints', () => {
    const openapi = readFileSync(openapiPath, 'utf8');
    expect(openapi).toContain('/v1/transactions:');
    expect(openapi).toContain('/v1/accounts:');
    expect(openapi).toContain('/v1/admin/api-keys:');
    expect(openapi).toContain('/v1/ledgers:');
    expect(openapi).toContain('/v1/entries:');
  });
});

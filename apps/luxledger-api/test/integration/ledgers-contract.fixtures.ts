import { expect } from 'bun:test';
import {
  type LedgerResponse,
  ledgerByIdParamsSchema,
  ledgerResponseSchema,
  type TrialBalanceResponse,
  trialBalanceResponseSchema,
} from '@api/contracts/ledgers';
import {
  extractPathMethodSection,
  extractPropertyNames,
  extractRequiredList,
  extractSchemaSection,
} from './openapi-contract-helpers';

export const assertLedgerResponseShape = (payload: LedgerResponse): void => {
  expect(Object.keys(payload).sort()).toEqual(Object.keys(ledgerResponseSchema.properties).sort());
};

export const assertLedgersListShape = (payload: LedgerResponse[]): void => {
  expect(Array.isArray(payload)).toBeTrue();
  for (const ledger of payload) {
    assertLedgerResponseShape(ledger);
  }
};

export const assertTrialBalanceResponseShape = (payload: TrialBalanceResponse): void => {
  expect(Object.keys(payload).sort()).toEqual(
    Object.keys(trialBalanceResponseSchema.properties).sort(),
  );
};

export const assertOpenApiLedgersContractsSynced = (openapiYaml: string): void => {
  const ledgerSection = extractSchemaSection(openapiYaml, 'Ledger');
  expect(extractRequiredList(ledgerSection)).toEqual([...ledgerResponseSchema.required].sort());
  expect(extractPropertyNames(ledgerSection)).toEqual(
    Object.keys(ledgerResponseSchema.properties).sort(),
  );

  const trialBalanceSection = extractSchemaSection(openapiYaml, 'TrialBalanceResponse');
  expect(extractRequiredList(trialBalanceSection)).toEqual(
    [...trialBalanceResponseSchema.required].sort(),
  );
  expect(extractPropertyNames(trialBalanceSection)).toEqual(
    Object.keys(trialBalanceResponseSchema.properties).sort(),
  );
  expect(trialBalanceSection).toContain('is_contra:');

  const createLedgerSection = extractPathMethodSection(openapiYaml, '/v1/ledgers', 'post');
  expect(createLedgerSection).toContain("$ref: '#/components/schemas/CreateLedgerRequest'");
  expect(createLedgerSection).toContain("$ref: '#/components/schemas/Ledger'");

  const listLedgersSection = extractPathMethodSection(openapiYaml, '/v1/ledgers', 'get');
  expect(listLedgersSection).toContain("$ref: '#/components/schemas/LedgersListResponse'");

  const getLedgerByIdSection = extractPathMethodSection(openapiYaml, '/v1/ledgers/{id}', 'get');
  expect(getLedgerByIdSection).toContain("$ref: '#/components/schemas/Ledger'");
  for (const field of ledgerByIdParamsSchema.required) {
    expect(getLedgerByIdSection).toContain(`${field}`);
  }

  const getTrialBalanceSection = extractPathMethodSection(
    openapiYaml,
    '/v1/ledgers/{ledger_id}/trial-balance',
    'get',
  );
  expect(getTrialBalanceSection).toContain("$ref: '#/components/schemas/TrialBalanceResponse'");
};

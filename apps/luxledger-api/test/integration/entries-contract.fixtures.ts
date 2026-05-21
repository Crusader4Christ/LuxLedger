import { expect } from 'bun:test';
import {
  type EntriesPageResponse,
  type EntryResponse,
  entriesPageResponseSchema,
  entryResponseSchema,
} from '@lux/ledger-http/contracts';
import {
  extractPathMethodSection,
  extractPropertyNames,
  extractRequiredList,
  extractSchemaSection,
} from './openapi-contract-helpers';

export const assertEntryResponseShape = (payload: EntryResponse): void => {
  expect(Object.keys(payload).sort()).toEqual(Object.keys(entryResponseSchema.properties).sort());
};

export const assertEntriesPageShape = (payload: EntriesPageResponse): void => {
  expect(Object.keys(payload).sort()).toEqual(
    Object.keys(entriesPageResponseSchema.properties).sort(),
  );
  expect(Array.isArray(payload.data)).toBeTrue();
  expect(payload.next_cursor === null || typeof payload.next_cursor === 'string').toBeTrue();
};

export const assertOpenApiEntriesContractsSynced = (openapiYaml: string): void => {
  const entriesPageSection = extractSchemaSection(openapiYaml, 'EntriesPage');
  expect(extractRequiredList(entriesPageSection)).toEqual(
    [...entriesPageResponseSchema.required].sort(),
  );
  expect(extractPropertyNames(entriesPageSection)).toEqual(
    Object.keys(entriesPageResponseSchema.properties).sort(),
  );
  expect(entriesPageSection).toContain('transaction_id:');
  expect(entriesPageSection).toContain('account_id:');

  const entriesRouteSection = extractPathMethodSection(openapiYaml, '/v1/entries', 'get');
  expect(entriesRouteSection).toContain("$ref: '#/components/schemas/EntriesPage'");
  expect(entriesRouteSection).toContain("- $ref: '#/components/parameters/Limit'");
  expect(entriesRouteSection).toContain("- $ref: '#/components/parameters/Cursor'");
};

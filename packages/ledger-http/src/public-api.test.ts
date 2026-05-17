import { expect, test } from 'bun:test';
import * as publicApi from './index';

test('public API includes shared HTTP contracts and primitives', () => {
  const keys = Object.keys(publicApi);
  expect(keys).toContain('createTransactionRequestSchema');
  expect(keys).toContain('createAccountBodySchema');
  expect(keys).toContain('createApiKeyBodySchema');
  expect(keys).toContain('createLedgerBodySchema');
  expect(keys).toContain('entriesPageResponseSchema');
  expect(keys).toContain('ApiKeyRole');
  expect(keys).toContain('mapDomainErrorToHttp');
});

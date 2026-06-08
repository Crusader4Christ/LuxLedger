import { expect } from 'bun:test';
import { AccountSide } from '@lux/ledger';
import {
  type AccountResponse,
  type AccountsPageResponse,
  accountByIdParamsSchema,
  accountResponseSchema,
  accountsPageResponseSchema,
  type CreateAccountRequest,
  createAccountBodySchema,
} from '@lux/ledger-http/contracts';
import {
  extractPathMethodSection,
  extractPropertyNames,
  extractRequiredList,
  extractSchemaSection,
} from './openapi-contract-helpers';

export const createAccountRequestFactory = (ledgerId: string): CreateAccountRequest => ({
  ledger_id: ledgerId,
  name: 'Cash',
  side: AccountSide.DEBIT,
  currency: 'USD',
});

export const assertAccountResponseShape = (payload: AccountResponse): void => {
  expect(Object.keys(payload).sort()).toEqual(Object.keys(accountResponseSchema.properties).sort());
};

export const assertAccountsPageShape = (payload: AccountsPageResponse): void => {
  expect(Object.keys(payload).sort()).toEqual(
    Object.keys(accountsPageResponseSchema.properties).sort(),
  );
  expect(Array.isArray(payload.data)).toBeTrue();
  expect(payload.next_cursor === null || typeof payload.next_cursor === 'string').toBeTrue();
};

export const assertOpenApiAccountsContractsSynced = (openapiYaml: string): void => {
  const createAccountRequestSection = extractSchemaSection(openapiYaml, 'CreateAccountRequest');
  expect(extractRequiredList(createAccountRequestSection)).toEqual(
    [...createAccountBodySchema.required].sort(),
  );
  expect(extractPropertyNames(createAccountRequestSection)).toEqual(
    Object.keys(createAccountBodySchema.properties).sort(),
  );

  const accountSection = extractSchemaSection(openapiYaml, 'Account');
  expect(extractRequiredList(accountSection)).toEqual([...accountResponseSchema.required].sort());
  expect(extractPropertyNames(accountSection)).toEqual(
    Object.keys(accountResponseSchema.properties).sort(),
  );

  const accountsPageSection = extractSchemaSection(openapiYaml, 'AccountsPage');
  expect(extractRequiredList(accountsPageSection)).toEqual(
    [...accountsPageResponseSchema.required].sort(),
  );
  expect(extractPropertyNames(accountsPageSection)).toEqual(
    Object.keys(accountsPageResponseSchema.properties).sort(),
  );

  expect(accountsPageSection).toMatch(/next_cursor:\n(?:\s{10}.+\n)*\s{10}nullable:\s*true/);

  const createAccountSection = extractPathMethodSection(openapiYaml, '/v1/accounts', 'post');
  expect(createAccountSection).toContain("$ref: '#/components/schemas/CreateAccountRequest'");
  expect(createAccountSection).toContain("$ref: '#/components/schemas/Account'");

  const listAccountsSection = extractPathMethodSection(openapiYaml, '/v1/accounts', 'get');
  expect(listAccountsSection).toContain("$ref: '#/components/schemas/AccountsPage'");
  expect(listAccountsSection).toContain("- $ref: '#/components/parameters/Limit'");
  expect(listAccountsSection).toContain("- $ref: '#/components/parameters/Cursor'");
  expect(listAccountsSection).toContain("- $ref: '#/components/parameters/LedgerIdQuery'");
  expect(listAccountsSection.includes("'404':")).toBeFalse();

  const getAccountByIdSection = extractPathMethodSection(openapiYaml, '/v1/accounts/{id}', 'get');
  expect(getAccountByIdSection).toContain("$ref: '#/components/schemas/Account'");
  expect(getAccountByIdSection).toContain("'404':");

  for (const field of accountByIdParamsSchema.required) {
    expect(getAccountByIdSection).toContain(`${field}`);
  }
};

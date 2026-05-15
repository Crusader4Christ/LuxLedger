import { expect } from 'bun:test';
import {
  type AccountResponse,
  type AccountsPageResponse,
  accountByIdParamsSchema,
  accountResponseSchema,
  accountsPageResponseSchema,
  type CreateAccountRequest,
  createAccountBodySchema,
} from '@api/contracts/accounts';
import { AccountSide } from '@lux/ledger';

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
  const normalizeList = (value: string) =>
    value
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .sort();

  const extractSchemaSection = (schemaName: string): string => {
    const startMatch = openapiYaml.match(new RegExp(`^\\s{4}${schemaName}:\\s*$`, 'm'));
    if (!startMatch || startMatch.index === undefined) {
      throw new Error(`OpenAPI schema not found: ${schemaName}`);
    }

    const tail = openapiYaml.slice(startMatch.index + startMatch[0].length);
    const endMatch = tail.match(/\n\s{4}[A-Za-z0-9_]+:\s*$/m);
    const end = endMatch?.index ?? tail.length;
    return tail.slice(0, end);
  };

  const extractPathMethodSection = (path: string, method: string): string => {
    const pathMatch = openapiYaml.match(new RegExp(`^\\s*${path}:\\s*$`, 'm'));
    if (!pathMatch || pathMatch.index === undefined) {
      throw new Error(`OpenAPI path not found: ${path}`);
    }

    const fromPath = openapiYaml.slice(pathMatch.index);
    const pathHeaderMatch = fromPath.match(/^\s*\/v1\/[^\n]+:\s*$/m);
    const pathHeaderLength = pathHeaderMatch?.[0].length ?? 0;
    const pathBody = fromPath.slice(pathHeaderLength);

    const methodMatch = pathBody.match(new RegExp(`^\\s*${method}:\\s*$`, 'm'));
    if (!methodMatch || methodMatch.index === undefined) {
      throw new Error(`OpenAPI method not found: ${method} under ${path}`);
    }

    const sectionStart =
      pathMatch.index + pathHeaderLength + methodMatch.index + methodMatch[0].length;
    const tail = openapiYaml.slice(sectionStart);
    const endMatch = tail.match(/\n\s*\/v1\/[^\n]+:\s*$/m);
    const end = endMatch?.index ?? tail.length;
    return tail.slice(0, end);
  };

  const extractRequiredList = (section: string): string[] => {
    const match = section.match(/required:\s*\[([^\]]+)\]/);
    if (!match) {
      throw new Error('required list not found in OpenAPI section');
    }
    return normalizeList(match[1]);
  };

  const extractPropertyNames = (section: string): string[] => {
    const propertiesIndex = section.indexOf('properties:');
    if (propertiesIndex === -1) {
      throw new Error('properties block not found in OpenAPI section');
    }

    const afterProperties = section.slice(propertiesIndex);
    const names = [...afterProperties.matchAll(/^\s{8}([a-z_]+):\s*$/gm)].map(
      (match) => match[1] ?? '',
    );

    return names.filter((name) => name.length > 0).sort();
  };

  const createAccountRequestSection = extractSchemaSection('CreateAccountRequest');
  expect(extractRequiredList(createAccountRequestSection)).toEqual(
    [...createAccountBodySchema.required].sort(),
  );
  expect(extractPropertyNames(createAccountRequestSection)).toEqual(
    Object.keys(createAccountBodySchema.properties).sort(),
  );

  const accountSection = extractSchemaSection('Account');
  expect(extractRequiredList(accountSection)).toEqual([...accountResponseSchema.required].sort());
  expect(extractPropertyNames(accountSection)).toEqual(
    Object.keys(accountResponseSchema.properties).sort(),
  );

  const accountsPageSection = extractSchemaSection('AccountsPage');
  expect(extractRequiredList(accountsPageSection)).toEqual(
    [...accountsPageResponseSchema.required].sort(),
  );
  expect(extractPropertyNames(accountsPageSection)).toEqual(
    Object.keys(accountsPageResponseSchema.properties).sort(),
  );

  expect(accountsPageSection).toMatch(/next_cursor:\n(?:\s{10}.+\n)*\s{10}nullable:\s*true/);

  const createAccountSection = extractPathMethodSection('/v1/accounts', 'post');
  expect(createAccountSection).toContain("$ref: '#/components/schemas/CreateAccountRequest'");
  expect(createAccountSection).toContain("$ref: '#/components/schemas/Account'");

  const listAccountsSection = extractPathMethodSection('/v1/accounts', 'get');
  expect(listAccountsSection).toContain("$ref: '#/components/schemas/AccountsPage'");
  expect(listAccountsSection).toContain("- $ref: '#/components/parameters/Limit'");
  expect(listAccountsSection).toContain("- $ref: '#/components/parameters/Cursor'");
  expect(listAccountsSection).toContain("- $ref: '#/components/parameters/LedgerIdQuery'");
  expect(listAccountsSection.includes("'404':")).toBeFalse();

  const getAccountByIdSection = extractPathMethodSection('/v1/accounts/{id}', 'get');
  expect(getAccountByIdSection).toContain("$ref: '#/components/schemas/Account'");
  expect(getAccountByIdSection).toContain("'404':");

  for (const field of accountByIdParamsSchema.required) {
    expect(getAccountByIdSection).toContain(`${field}`);
  }
};

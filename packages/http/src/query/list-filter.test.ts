import { describe, expect, it } from 'bun:test';
import {
  MAX_WHERE_LENGTH,
  parseWhere,
  readWhereParameter,
  whereFieldsToJsonSchema,
} from './list-filter';
import { accountFilterFields, transactionFilterFields } from './list-filter-fields';

describe('typed list filter parsing', () => {
  it('parses typed values, aliases snake case and preserves bigint precision', () => {
    expect(
      parseWhere<Record<string, unknown>>(
        '{"balance_minor":{"gte":"9007199254740993"}}',
        accountFilterFields,
      ),
    ).toEqual({
      balanceMinor: { gte: 9007199254740993n },
    });
    expect(
      parseWhere<Record<string, unknown>>(
        '{"ledger_id":{"eq":"123e4567-e89b-12d3-a456-426614174000"}}',
        accountFilterFields,
      ),
    ).toEqual({
      ledgerId: { eq: '123e4567-e89b-12d3-a456-426614174000' },
    });
  });

  it('rejects malformed, unknown, nested, repeated and oversized filters', () => {
    for (const value of [
      '[]',
      '1',
      '{',
      '{"tenant_id":{"eq":"x"}}',
      '{"name":{}}',
      '{"name":{"contains":"x"}}',
    ]) {
      expect(parseWhere(value, accountFilterFields)).toBeNull();
    }
    expect(readWhereParameter('/?where=%7B%7D&where=%7B%7D', accountFilterFields)).toBeNull();
    expect(readWhereParameter('/?where%5Bname%5D%5Beq%5D=Cash', accountFilterFields)).toBeNull();
    expect(
      readWhereParameter('/?where=%7B%7D&where%5Bname%5D%5Beq%5D=Cash', accountFilterFields),
    ).toBeNull();
    expect(parseWhere(`{"name":{"eq":"${'x'.repeat(8200)}"}}`, accountFilterFields)).toBeNull();
  });

  it('accepts omitted and empty filters as no extra constraint', () => {
    expect(parseWhere(undefined, accountFilterFields)).toBeUndefined();
    expect(parseWhere('{}', accountFilterFields)).toBeUndefined();
    expect(parseWhere('', accountFilterFields)).toBeNull();
  });

  it('allows null only for eq/ne and validates timezone date-times', () => {
    expect(
      parseWhere<Record<string, unknown>>('{"code":{"eq":null}}', accountFilterFields),
    ).toEqual({ code: { eq: null } });
    expect(parseWhere('{"code":{"in":[null]}}', accountFilterFields)).toBeNull();
    expect(parseWhere('{"code":{"gt":null}}', accountFilterFields)).toBeNull();
    const timeFields = { created_at: { kind: 'date-time', ordered: true } } as const;
    expect(
      parseWhere('{"created_at":{"gte":"2024-02-29T10:20:30+02:00"}}', timeFields),
    ).not.toBeNull();
    expect(parseWhere('{"created_at":{"gte":"2025-02-29T10:20:30Z"}}', timeFields)).toBeNull();
  });

  it('documents nullable enum values as JSON Schema nulls', () => {
    const schema = whereFieldsToJsonSchema(transactionFilterFields) as {
      properties: { relation_type: { properties: { eq: { type: string[]; enum: unknown[] } } } };
    };
    expect(schema.properties.relation_type.properties.eq).toEqual({
      type: ['string', 'null'],
      enum: ['REVERSAL', 'CORRECTION', null],
    });
  });

  it('enforces enum, UUID, boolean and decimal integer wire types', () => {
    expect(parseWhere('{"side":{"eq":"DEBIT"}}', accountFilterFields)).not.toBeNull();
    expect(parseWhere('{"side":{"eq":"debit"}}', accountFilterFields)).toBeNull();
    expect(parseWhere('{"id":{"eq":"not-a-uuid"}}', accountFilterFields)).toBeNull();
    expect(parseWhere('{"grant_enabled":{"eq":true}}', accountFilterFields)).not.toBeNull();
    expect(parseWhere('{"grant_enabled":{"eq":"true"}}', accountFilterFields)).toBeNull();
    expect(parseWhere('{"balance_minor":{"gte":"0"}}', accountFilterFields)).not.toBeNull();
    expect(
      parseWhere('{"balance_minor":{"eq":"9223372036854775807"}}', accountFilterFields),
    ).not.toBeNull();
    expect(
      parseWhere('{"balance_minor":{"eq":"9223372036854775808"}}', accountFilterFields),
    ).toBeNull();
    expect(
      parseWhere('{"balance_minor":{"eq":"-9223372036854775809"}}', accountFilterFields),
    ).toBeNull();
    for (const value of ['1.2', '1e3', '+1', '01', '--1']) {
      expect(parseWhere(`{"balance_minor":{"gte":"${value}"}}`, accountFilterFields)).toBeNull();
    }
    for (const op of ['eq', 'ne', 'gt', 'gte', 'lt', 'lte']) {
      expect(parseWhere(`{"balance_minor":{"${op}":"-1"}}`, accountFilterFields)).not.toBeNull();
    }
  });

  it('accepts in arrays at the supported boundaries and rejects empty/oversized arrays', () => {
    const one = JSON.stringify({ name: { in: ['one'] } });
    const hundred = JSON.stringify({ name: { in: Array.from({ length: 100 }, (_, i) => `${i}`) } });
    const hundredOne = JSON.stringify({
      name: { in: Array.from({ length: 101 }, (_, i) => `${i}`) },
    });
    expect(parseWhere(one, accountFilterFields)).not.toBeNull();
    expect(parseWhere(hundred, accountFilterFields)).not.toBeNull();
    expect(parseWhere(hundredOne, accountFilterFields)).toBeNull();
    expect(parseWhere('{"name":{"in":[]}}', accountFilterFields)).toBeNull();
  });

  it('measures the decoded where payload limit in UTF-8 bytes', () => {
    const prefix = '{"name":{"eq":"';
    const suffix = '"}}';
    const atLimit = `${prefix}${'x'.repeat(MAX_WHERE_LENGTH - prefix.length - suffix.length)}${suffix}`;
    expect(new TextEncoder().encode(atLimit).byteLength).toBe(MAX_WHERE_LENGTH);
    expect(parseWhere(atLimit, accountFilterFields)).not.toBeNull();
    const overLimit = `${prefix}${'😀'.repeat(MAX_WHERE_LENGTH / 4)}${suffix}`;
    expect(new TextEncoder().encode(overLimit).byteLength).toBeGreaterThan(MAX_WHERE_LENGTH);
    expect(parseWhere(overLimit, accountFilterFields)).toBeNull();
  });
});

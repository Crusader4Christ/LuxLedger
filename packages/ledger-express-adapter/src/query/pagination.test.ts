import { describe, expect, it } from 'bun:test';
import { parsePaginationQuery } from './pagination';

describe('Express pagination query parsing', () => {
  it('applies the shared default limit', () => {
    expect(parsePaginationQuery({})).toEqual({
      limit: 50,
      cursor: undefined,
    });
  });

  it('preserves valid limit and cursor values', () => {
    expect(parsePaginationQuery({ limit: '25', cursor: 'next-page' })).toEqual({
      limit: 25,
      cursor: 'next-page',
    });
  });

  it('rejects invalid shared pagination values', () => {
    expect(parsePaginationQuery({ limit: '201' })).toBeNull();
    expect(parsePaginationQuery({ cursor: '' })).toBeNull();
  });
});

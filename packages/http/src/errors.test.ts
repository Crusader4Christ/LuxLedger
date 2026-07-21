import { describe, expect, it } from 'bun:test';
import { toHttpErrorPayload } from './errors';

describe('toHttpErrorPayload', () => {
  it('maps structurally compatible domain errors from another public export identity', () => {
    const error = Object.assign(new Error('total debits must equal total credits'), {
      code: 'UNBALANCED_TRANSACTION',
      httpStatus: 400,
    });

    expect(toHttpErrorPayload(error)).toEqual({
      statusCode: 400,
      error: 'UNBALANCED_TRANSACTION',
      message: 'total debits must equal total credits',
      details: undefined,
    });
  });

  it('hides raw database errors even when they expose code and message', () => {
    const error = Object.assign(new Error('duplicate key violates transactions_reference_key'), {
      code: '23505',
      constraint_name: 'transactions_reference_key',
    });

    expect(toHttpErrorPayload(error)).toEqual({
      statusCode: 500,
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });
});

import { expect, test } from 'bun:test';
import { InvariantViolationError } from '@luxledger/core/application';
import { toHttpErrorPayload } from '../../http/src/errors';
import { createDbClient } from './client';

test('keeps tenant relationship diagnostics internal and exposes a generic constraint error', async () => {
  const client = createDbClient({ databaseUrl: 'postgresql://localhost/unused' });
  const databaseError = {
    code: 'LL003',
    message: 'invalid tenant-scoped allocation relationship',
    detail: 'private database diagnostic',
  };
  try {
    const error = await client
      .execute('reserve grant allocations', async () => {
        throw databaseError;
      })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(InvariantViolationError);
    expect((error as Error).cause).toBe(databaseError);
    expect(toHttpErrorPayload(error)).toEqual({
      statusCode: 400,
      error: 'INVARIANT_VIOLATION',
      message: 'Unable to reserve grant allocations: data constraints violated',
      details: undefined,
    });
    expect(JSON.stringify(toHttpErrorPayload(error))).not.toContain('LL003');
    expect(JSON.stringify(toHttpErrorPayload(error))).not.toContain(databaseError.detail);
  } finally {
    await client.sql.end();
  }
});

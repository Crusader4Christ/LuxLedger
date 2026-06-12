import { describe, expect, it } from 'bun:test';
import { InvariantViolationError, RepositoryError } from '@lux/ledger/application';
import { createDbClient } from './client';

describe('db client module', () => {
  it('can be imported without DATABASE_URL', async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      await expect(import('./client')).resolves.toBeDefined();
    } finally {
      process.env.DATABASE_URL = previous;
    }
  });

  it('throws when createDbClient is called without DATABASE_URL', async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      expect(() => createDbClient()).toThrow('DATABASE_URL is required');
    } finally {
      process.env.DATABASE_URL = previous;
    }
  });

  it('execute preserves domain errors', async () => {
    const client = createDbClient({ databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused' });
    const error = new InvariantViolationError('domain failure');

    try {
      await expect(
        client.execute('test operation', async () => {
          throw error;
        }),
      ).rejects.toBe(error);
    } finally {
      await client.sql.end({ timeout: 0 });
    }
  });

  it('execute maps nested constraint errors', async () => {
    const client = createDbClient({ databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused' });

    try {
      await expect(
        client.execute('test operation', async () => {
          throw new Error('query failed', { cause: { code: '23505' } });
        }),
      ).rejects.toBeInstanceOf(InvariantViolationError);
    } finally {
      await client.sql.end({ timeout: 0 });
    }
  });

  it('execute maps unknown persistence errors', async () => {
    const client = createDbClient({ databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused' });

    try {
      await expect(
        client.execute('test operation', async () => {
          throw new Error('unexpected');
        }),
      ).rejects.toBeInstanceOf(RepositoryError);
    } finally {
      await client.sql.end({ timeout: 0 });
    }
  });
});

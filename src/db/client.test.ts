import { describe, expect, it } from 'bun:test';

describe('db client module', () => {
  it('can be imported without DATABASE_URL', async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      await expect(import('@db/client')).resolves.toBeDefined();
    } finally {
      process.env.DATABASE_URL = previous;
    }
  });

  it('throws when createDbClient is called without DATABASE_URL', async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const { createDbClient } = await import('@db/client');
      expect(() => createDbClient()).toThrow('DATABASE_URL is required');
    } finally {
      process.env.DATABASE_URL = previous;
    }
  });
});

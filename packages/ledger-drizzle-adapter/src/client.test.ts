import { describe, expect, it } from 'bun:test';
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
});

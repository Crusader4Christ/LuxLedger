import { describe, expect, it } from 'bun:test';

import { buildServer } from '@api/server';

describe('server', () => {
  it('returns health response', async () => {
    const server = buildServer({ logger: false });

    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    const payload = JSON.parse(response.body) as { ok: boolean };

    expect(response.statusCode).toBe(200);
    expect(payload).toEqual({ ok: true });

    await server.close();
  });
});

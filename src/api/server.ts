import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export interface BuildServerOptions {
  logger?: FastifyServerOptions['logger'];
}

export const buildServer = (options: BuildServerOptions = {}): FastifyInstance => {
  const server = Fastify({ logger: options.logger ?? true });

  server.get('/health', async () => {
    return { ok: true };
  });

  return server;
};

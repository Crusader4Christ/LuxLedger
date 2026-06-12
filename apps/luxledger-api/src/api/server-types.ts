import type { FastifyServerOptions } from 'fastify';

export interface CreateServerCoreOptions {
  readinessCheck: () => Promise<void>;
  logger: FastifyServerOptions['logger'];
}

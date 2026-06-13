import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    apiPath?: string;
    requestStartedAt?: bigint;
  }
}

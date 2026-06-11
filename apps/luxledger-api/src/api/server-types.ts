import type { JwtAuthConfig } from '@api/auth/jwt';
import type { RateLimitConfig } from '@api/rate-limit/policy';
import type { ApplicationServices } from '@lux/ledger/application';
import type { FastifyServerOptions } from 'fastify';

export interface ApplicationDependencies {
  services: ApplicationServices;
  jwtAuth: JwtAuthConfig;
  rateLimit: RateLimitConfig;
}

export interface CreateServerCoreOptions {
  readinessCheck: () => Promise<void>;
  logger: FastifyServerOptions['logger'];
}

import { ForbiddenError, UnauthorizedError } from '@luxledger/core/application';
import { ApiKeyRole } from '@luxledger/http/contracts';
import type { RequestContext, RequestWithContext } from '../types';

export const requireContext = (req: RequestWithContext): RequestContext => {
  if (!req.tenantId || !req.apiKeyId || !req.apiKeyRole) {
    throw new UnauthorizedError('Bearer token is required');
  }
  return {
    tenantId: req.tenantId,
    apiKeyId: req.apiKeyId,
    apiKeyRole: req.apiKeyRole,
  };
};

export const assertAdmin = (context: RequestContext): void => {
  if (context.apiKeyRole !== ApiKeyRole.ADMIN) {
    throw new ForbiddenError('Admin API key is required');
  }
};

import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiKeyRole } from '@lux/ledger';
import type { AuthContext } from '@lux/ledger/application';
import { UnauthorizedError } from '@lux/ledger/application';

const JWT_HEADER = {
  alg: 'HS256',
  typ: 'JWT',
} as const;

interface JwtPayload {
  iss: string;
  sub: string;
  tenant_id: string;
  role: ApiKeyRole;
  iat: number;
  exp: number;
}

export interface JwtAuthConfig {
  signingKey: string;
  previousSigningKeys: string[];
  issuer: string;
  accessTokenTtlSeconds: number;
  clockSkewSeconds: number;
}

export interface VerifyAccessTokenOptions {
  now?: Date;
  onPreviousSigningKeyUsed?: (details: { previousSigningKeyIndex: number }) => void;
}

const encodeBase64Url = (value: string): string => Buffer.from(value, 'utf8').toString('base64url');

const decodeBase64Url = (value: string): string => Buffer.from(value, 'base64url').toString('utf8');

const sign = (input: string, signingKey: string): string =>
  createHmac('sha256', signingKey).update(input, 'utf8').digest('base64url');

const hasValidSignature = (
  encodedSignature: string,
  signingInput: string,
  verificationKey: string,
): boolean => {
  const expectedSignature = sign(signingInput, verificationKey);
  const actualBuffer = Buffer.from(encodedSignature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
};

const assertPayload = (value: unknown, expectedIssuer: string): JwtPayload => {
  if (typeof value !== 'object' || value === null) {
    throw new UnauthorizedError('Invalid access token');
  }

  const payload = value as Partial<JwtPayload>;
  const validRole = payload.role === ApiKeyRole.ADMIN || payload.role === ApiKeyRole.SERVICE;

  if (
    payload.iss !== expectedIssuer ||
    typeof payload.sub !== 'string' ||
    typeof payload.tenant_id !== 'string' ||
    !validRole ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number' ||
    payload.exp <= payload.iat
  ) {
    throw new UnauthorizedError('Invalid access token');
  }

  return payload as JwtPayload;
};

export const issueAccessToken = (
  context: AuthContext,
  config: JwtAuthConfig,
  now: Date = new Date(),
): string => {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + config.accessTokenTtlSeconds;

  const payload: JwtPayload = {
    iss: config.issuer,
    sub: context.apiKeyId,
    tenant_id: context.tenantId,
    role: context.role,
    iat,
    exp,
  };

  const encodedHeader = encodeBase64Url(JSON.stringify(JWT_HEADER));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(signingInput, config.signingKey);

  return `${signingInput}.${signature}`;
};

export const verifyAccessToken = (
  token: string,
  config: JwtAuthConfig,
  options: VerifyAccessTokenOptions = {},
): AuthContext => {
  const now = options.now ?? new Date();
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new UnauthorizedError('Invalid access token');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new UnauthorizedError('Invalid access token');
  }

  let header: unknown;
  let payloadValue: unknown;
  try {
    header = JSON.parse(decodeBase64Url(encodedHeader));
    payloadValue = JSON.parse(decodeBase64Url(encodedPayload));
  } catch {
    throw new UnauthorizedError('Invalid access token');
  }

  if (
    typeof header !== 'object' ||
    header === null ||
    (header as Record<string, unknown>).alg !== JWT_HEADER.alg ||
    (header as Record<string, unknown>).typ !== JWT_HEADER.typ
  ) {
    throw new UnauthorizedError('Invalid access token');
  }

  const payload = assertPayload(payloadValue, config.issuer);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const verificationKeys = [config.signingKey, ...config.previousSigningKeys];
  const verificationKeyIndex = verificationKeys.findIndex((verificationKey) =>
    hasValidSignature(encodedSignature, signingInput, verificationKey),
  );

  if (verificationKeyIndex === -1) {
    throw new UnauthorizedError('Invalid access token');
  }

  if (verificationKeyIndex > 0) {
    options.onPreviousSigningKeyUsed?.({
      previousSigningKeyIndex: verificationKeyIndex - 1,
    });
  }

  const nowUnix = Math.floor(now.getTime() / 1000);
  if (payload.iat > nowUnix + config.clockSkewSeconds) {
    throw new UnauthorizedError('Invalid access token');
  }

  if (payload.exp <= nowUnix - config.clockSkewSeconds) {
    throw new UnauthorizedError('Access token expired');
  }

  return {
    apiKeyId: payload.sub,
    tenantId: payload.tenant_id,
    role: payload.role,
  };
};

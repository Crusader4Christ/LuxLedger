import { createHash, randomBytes } from 'node:crypto';
import { ForbiddenError, InvariantViolationError, UnauthorizedError } from '@core/errors';
import type {
  ApiKeyListItem,
  ApiKeyRepository,
  ApiKeyRole,
  AuthContext,
  BootstrapAdminInput,
  BootstrapAdminResult,
  CreateApiKeyInput,
  CreateApiKeyResult,
} from '@core/types';

const API_KEY_PREFIX = 'llk_';
const API_KEY_BYTES = 32;

const hashApiKey = (apiKey: string): string =>
  createHash('sha256').update(apiKey, 'utf8').digest('hex');

export class ApiKeyService {
  private readonly repository: ApiKeyRepository;

  public constructor(repository: ApiKeyRepository) {
    this.repository = repository;
  }

  public async authenticate(rawApiKey: string): Promise<AuthContext> {
    const normalized = rawApiKey.trim();
    if (normalized.length === 0) {
      throw new UnauthorizedError('API key is required');
    }

    const keyHash = hashApiKey(normalized);
    const key = await this.repository.findActiveApiKeyByHash(keyHash);
    if (!key || key.revokedAt) {
      throw new UnauthorizedError('Invalid API key');
    }

    return {
      apiKeyId: key.id,
      tenantId: key.tenantId,
      role: key.role,
    };
  }

  public async createApiKey(
    actor: AuthContext,
    input: CreateApiKeyInput,
  ): Promise<CreateApiKeyResult> {
    this.assertAdmin(actor);
    this.assertSameTenant(actor.tenantId, input.tenantId);
    this.assertNonEmpty(input.name, 'name is required');
    this.assertRole(input.role);

    const apiKey = `${API_KEY_PREFIX}${randomBytes(API_KEY_BYTES).toString('hex')}`;
    const created = await this.repository.createApiKey({
      tenantId: input.tenantId,
      name: input.name.trim(),
      role: input.role,
      keyHash: hashApiKey(apiKey),
    });

    return { apiKey, key: created };
  }

  public async listApiKeys(actor: AuthContext): Promise<ApiKeyListItem[]> {
    this.assertAdmin(actor);
    return this.repository.listApiKeys(actor.tenantId);
  }

  public async bootstrapInitialAdmin(input: BootstrapAdminInput): Promise<BootstrapAdminResult> {
    this.assertNonEmpty(input.tenantName, 'tenantName is required');
    this.assertNonEmpty(input.keyName, 'keyName is required');
    this.assertNonEmpty(input.rawApiKey, 'rawApiKey is required');

    const existingKeys = await this.repository.countApiKeys();
    if (existingKeys > 0) {
      return { created: false };
    }

    const tenant = await this.repository.createTenant({ name: input.tenantName.trim() });
    const created = await this.repository.createApiKey({
      tenantId: tenant.id,
      name: input.keyName.trim(),
      role: 'ADMIN',
      keyHash: hashApiKey(input.rawApiKey),
    });

    return {
      created: true,
      tenantId: tenant.id,
      apiKeyId: created.id,
    };
  }

  public async revokeApiKey(actor: AuthContext, apiKeyId: string): Promise<void> {
    this.assertAdmin(actor);
    this.assertNonEmpty(apiKeyId, 'apiKeyId is required');

    const revoked = await this.repository.revokeApiKey(actor.tenantId, apiKeyId);
    if (!revoked) {
      throw new InvariantViolationError('API key not found');
    }
  }

  private assertAdmin(actor: AuthContext): void {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenError('Admin API key is required');
    }
  }

  private assertSameTenant(actorTenantId: string, tenantId: string): void {
    if (actorTenantId !== tenantId) {
      throw new ForbiddenError('Cross-tenant key management is not allowed');
    }
  }

  private assertNonEmpty(value: string, message: string): void {
    if (value.trim().length === 0) {
      throw new InvariantViolationError(message);
    }
  }

  private assertRole(role: ApiKeyRole): void {
    if (role !== 'ADMIN' && role !== 'SERVICE') {
      throw new InvariantViolationError('Invalid API key role');
    }
  }
}

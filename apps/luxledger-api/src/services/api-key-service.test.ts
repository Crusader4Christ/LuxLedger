import { describe, expect, it } from 'bun:test';
import { ApiKeyEntity, ApiKeyRole } from '@lux/ledger';
import { ApiKeyService } from '@services/api-key-service';
import { ForbiddenError, InvariantViolationError, UnauthorizedError } from '@services/errors';
import type { ApiKeyRepository } from '@services/types';

const hash = (value: string): string => new Bun.CryptoHasher('sha256').update(value).digest('hex');

class InMemoryApiKeyRepository implements ApiKeyRepository {
  private readonly keys = new Map<string, ApiKeyEntity>();

  public constructor(seed: ApiKeyEntity[]) {
    for (const key of seed) {
      this.keys.set(key.id, key);
    }
  }

  public async countApiKeys(): Promise<number> {
    return this.keys.size;
  }

  public async createTenant(input: {
    name: string;
  }): Promise<{ id: string; name: string; createdAt: Date }> {
    return {
      id: `tenant-${input.name.toLowerCase().replaceAll(/\s+/g, '-')}`,
      name: input.name,
      createdAt: new Date(),
    };
  }

  public async findActiveApiKeyByHash(keyHash: string): Promise<ApiKeyEntity | null> {
    for (const key of this.keys.values()) {
      if (key.keyHash === keyHash && key.revokedAt === null) {
        return key;
      }
    }
    return null;
  }

  public async findApiKeyById(apiKeyId: string): Promise<ApiKeyEntity | null> {
    return this.keys.get(apiKeyId) ?? null;
  }

  public async createApiKey(input: {
    tenantId: string;
    name: string;
    role: ApiKeyRole;
    keyHash: string;
  }): Promise<ApiKeyEntity> {
    const createdAt = new Date();
    const id = `key-${this.keys.size + 1}`;
    const key = new ApiKeyEntity({
      id,
      tenantId: input.tenantId,
      name: input.name,
      role: input.role,
      keyHash: input.keyHash,
      createdAt,
      revokedAt: null,
    });
    this.keys.set(id, key);
    return key;
  }

  public async listApiKeys(tenantId: string): Promise<ApiKeyEntity[]> {
    return [...this.keys.values()].filter((key) => key.tenantId === tenantId);
  }

  public async revokeApiKey(tenantId: string, apiKeyId: string): Promise<boolean> {
    const key = this.keys.get(apiKeyId);
    if (!key || key.tenantId !== tenantId || key.revokedAt !== null) {
      return false;
    }
    this.keys.set(
      apiKeyId,
      new ApiKeyEntity({
        id: key.id,
        tenantId: key.tenantId,
        name: key.name,
        role: key.role,
        keyHash: key.keyHash,
        createdAt: key.createdAt,
        revokedAt: new Date(),
      }),
    );
    return true;
  }
}

describe('ApiKeyService', () => {
  const adminKey = 'llk_admin_seed';
  const serviceKey = 'llk_service_seed';
  const repository = new InMemoryApiKeyRepository([
    new ApiKeyEntity({
      id: 'admin-1',
      tenantId: 'tenant-a',
      name: 'Admin',
      role: ApiKeyRole.ADMIN,
      keyHash: hash(adminKey),
      revokedAt: null,
      createdAt: new Date(),
    }),
    new ApiKeyEntity({
      id: 'service-1',
      tenantId: 'tenant-a',
      name: 'Service',
      role: ApiKeyRole.SERVICE,
      keyHash: hash(serviceKey),
      revokedAt: null,
      createdAt: new Date(),
    }),
  ]);
  const service = new ApiKeyService(repository);

  it('authenticates valid key', async () => {
    const auth = await service.authenticate(adminKey);
    expect(auth.role).toBe(ApiKeyRole.ADMIN);
    expect(auth.tenantId).toBe('tenant-a');
  });

  it('rejects invalid key', async () => {
    await expect(service.authenticate('invalid')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('admin can create and revoke key', async () => {
    const admin = await service.authenticate(adminKey);
    const created = await service.createApiKey(admin, {
      tenantId: admin.tenantId,
      name: 'Temp',
      role: ApiKeyRole.SERVICE,
    });
    expect(created.apiKey.startsWith('llk_')).toBeTrue();

    await service.revokeApiKey(admin, created.key.id);
    const list = await service.listApiKeys(admin);
    const revoked = list.find((key) => key.id === created.key.id);
    expect(revoked?.revokedAt).toBeDefined();
  });

  it('service key cannot manage keys', async () => {
    const actor = await service.authenticate(serviceKey);
    await expect(
      service.createApiKey(actor, {
        tenantId: actor.tenantId,
        name: 'Denied',
        role: ApiKeyRole.SERVICE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('createApiKey validates non-empty name', async () => {
    const admin = await service.authenticate(adminKey);
    await expect(
      service.createApiKey(admin, {
        tenantId: admin.tenantId,
        name: '   ',
        role: ApiKeyRole.SERVICE,
      }),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('bootstrapInitialAdmin creates first admin key when key store is empty', async () => {
    const emptyRepository = new InMemoryApiKeyRepository([]);
    const bootstrapService = new ApiKeyService(emptyRepository);

    const result = await bootstrapService.bootstrapInitialAdmin({
      tenantName: 'Bootstrap Tenant',
      keyName: 'Initial admin',
      rawApiKey: 'llk_bootstrap_admin',
    });

    expect(result.created).toBeTrue();
    expect(result.tenantId).toBeDefined();
    expect(result.apiKeyId).toBeDefined();
  });

  it('bootstrapInitialAdmin skips when at least one key already exists', async () => {
    const result = await service.bootstrapInitialAdmin({
      tenantName: 'Ignored',
      keyName: 'Ignored',
      rawApiKey: 'llk_ignored',
    });

    expect(result).toEqual({ created: false });
  });

  it('assertAccessTokenIsActive rejects revoked key', async () => {
    const admin = await service.authenticate(adminKey);
    await service.revokeApiKey(admin, 'service-1');

    await expect(
      service.assertAccessTokenIsActive({
        apiKeyId: 'service-1',
        tenantId: 'tenant-a',
        role: ApiKeyRole.SERVICE,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('assertAccessTokenIsActive rejects token context mismatch', async () => {
    await expect(
      service.assertAccessTokenIsActive({
        apiKeyId: 'admin-1',
        tenantId: 'tenant-b',
        role: ApiKeyRole.ADMIN,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

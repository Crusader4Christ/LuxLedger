import { describe, expect, it } from 'bun:test';
import { ApiKeyService } from '@core/api-key-service';
import { ForbiddenError, InvariantViolationError, UnauthorizedError } from '@core/errors';
import type { ApiKeyListItem, ApiKeyRepository, StoredApiKey } from '@core/types';

const hash = (value: string): string => new Bun.CryptoHasher('sha256').update(value).digest('hex');

class InMemoryApiKeyRepository implements ApiKeyRepository {
  private readonly keys = new Map<string, StoredApiKey & { name: string; createdAt: Date }>();

  public constructor(seed: Array<StoredApiKey & { name: string; createdAt: Date }>) {
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

  public async findActiveApiKeyByHash(keyHash: string): Promise<StoredApiKey | null> {
    for (const key of this.keys.values()) {
      if (key.keyHash === keyHash && key.revokedAt === null) {
        return key;
      }
    }
    return null;
  }

  public async createApiKey(input: {
    tenantId: string;
    name: string;
    role: 'ADMIN' | 'SERVICE';
    keyHash: string;
  }): Promise<ApiKeyListItem> {
    const createdAt = new Date();
    const id = `key-${this.keys.size + 1}`;
    this.keys.set(id, {
      id,
      tenantId: input.tenantId,
      role: input.role,
      keyHash: input.keyHash,
      revokedAt: null,
      name: input.name,
      createdAt,
    });
    return {
      id,
      tenantId: input.tenantId,
      name: input.name,
      role: input.role,
      createdAt,
      revokedAt: null,
    };
  }

  public async listApiKeys(tenantId: string): Promise<ApiKeyListItem[]> {
    return [...this.keys.values()]
      .filter((key) => key.tenantId === tenantId)
      .map((key) => ({
        id: key.id,
        tenantId: key.tenantId,
        name: key.name,
        role: key.role,
        createdAt: key.createdAt,
        revokedAt: key.revokedAt,
      }));
  }

  public async revokeApiKey(tenantId: string, apiKeyId: string): Promise<boolean> {
    const key = this.keys.get(apiKeyId);
    if (!key || key.tenantId !== tenantId || key.revokedAt !== null) {
      return false;
    }
    key.revokedAt = new Date();
    this.keys.set(apiKeyId, key);
    return true;
  }
}

describe('ApiKeyService', () => {
  const adminKey = 'llk_admin_seed';
  const serviceKey = 'llk_service_seed';
  const repository = new InMemoryApiKeyRepository([
    {
      id: 'admin-1',
      tenantId: 'tenant-a',
      role: 'ADMIN',
      keyHash: hash(adminKey),
      revokedAt: null,
      name: 'Admin',
      createdAt: new Date(),
    },
    {
      id: 'service-1',
      tenantId: 'tenant-a',
      role: 'SERVICE',
      keyHash: hash(serviceKey),
      revokedAt: null,
      name: 'Service',
      createdAt: new Date(),
    },
  ]);
  const service = new ApiKeyService(repository);

  it('authenticates valid key', async () => {
    const auth = await service.authenticate(adminKey);
    expect(auth.role).toBe('ADMIN');
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
      role: 'SERVICE',
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
        role: 'SERVICE',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('createApiKey validates non-empty name', async () => {
    const admin = await service.authenticate(adminKey);
    await expect(
      service.createApiKey(admin, {
        tenantId: admin.tenantId,
        name: '   ',
        role: 'SERVICE',
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
});

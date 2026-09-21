import { assertNonEmpty } from '../../utils';
import { AssetNotFoundError, InvariantViolationError } from '../errors';
import type { AssetRepository } from '../repositories.interface';
import type { Asset, CreateAssetInput } from '../types';

export class AssetService {
  public constructor(private readonly repository: AssetRepository) {}

  public async create(input: CreateAssetInput): Promise<Asset> {
    assertNonEmpty(input.tenantId, 'tenantId is required');
    if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(input.code)) {
      throw new InvariantViolationError(
        'asset code must be 2-32 uppercase letters, digits or underscores',
      );
    }
    if (!Number.isInteger(input.scale) || input.scale < 0 || input.scale > 18) {
      throw new InvariantViolationError('asset scale must be an integer from 0 to 18');
    }
    return this.repository.create(input);
  }

  public async getById(tenantId: string, assetId: string): Promise<Asset> {
    assertNonEmpty(tenantId, 'tenantId is required');
    assertNonEmpty(assetId, 'assetId is required');
    const asset = await this.repository.findById(tenantId, assetId);
    if (!asset) throw new AssetNotFoundError(assetId);
    return asset;
  }

  public async list(tenantId: string): Promise<Asset[]> {
    assertNonEmpty(tenantId, 'tenantId is required');
    return this.repository.list(tenantId);
  }
}

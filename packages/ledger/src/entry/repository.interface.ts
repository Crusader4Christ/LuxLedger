import type { EntryEntity } from './entity';
import type { CreateEntryInput } from './input.interface';

export interface EntryRepository {
  createMany(tenantId: string, entries: CreateEntryInput[]): Promise<EntryEntity[]>;
}

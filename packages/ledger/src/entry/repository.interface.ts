import type { EntryEntity } from './entity';
import type { CreateEntryInput } from './input.interface';

export interface EntryRepository {
  createEntries(tenantId: string, entries: CreateEntryInput[]): Promise<EntryEntity[]>;
}

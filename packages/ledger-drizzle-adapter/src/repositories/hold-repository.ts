import type {
  CommitHoldInput,
  CommitHoldResult,
  CreateHoldInput,
  CreateHoldResult,
  HoldApplicationRepository,
  VoidHoldInput,
  VoidHoldResult,
} from '@lux/ledger/application';
import type { DrizzleRepositoryContext } from '../repository-context';
import { DrizzleHoldStore } from './hold-store';

export class DrizzleHoldRepository implements HoldApplicationRepository {
  private readonly store: DrizzleHoldStore;

  public constructor(context: DrizzleRepositoryContext, store = new DrizzleHoldStore(context)) {
    this.store = store;
  }

  public create(input: CreateHoldInput): Promise<CreateHoldResult> {
    return this.store.createHold(input);
  }

  public commit(input: CommitHoldInput): Promise<CommitHoldResult> {
    return this.store.commitHold(input);
  }

  public void(input: VoidHoldInput): Promise<VoidHoldResult> {
    return this.store.voidHold(input);
  }
}

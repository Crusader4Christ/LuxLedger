import type { UnitOfWork, UnitOfWorkContext } from '../base/unit-of-work';
import type { ApplicationServices } from './services/application-services.interface';

export interface ApplicationUnitOfWorkContext extends UnitOfWorkContext {
  readonly services: ApplicationServices;
}

export type ApplicationUnitOfWork = UnitOfWork<ApplicationUnitOfWorkContext>;

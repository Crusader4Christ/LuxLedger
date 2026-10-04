import type { UnitOfWork, UnitOfWorkContext } from '../base/unit-of-work';
import type { ApplicationServices } from './services/application-services.interface';

export type TransactionQuery = <Row extends Record<string, unknown> = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<readonly Row[]>;

export interface ApplicationUnitOfWorkContext extends UnitOfWorkContext {
  readonly services: ApplicationServices;
  readonly query: TransactionQuery;
}

export type ApplicationUnitOfWork = UnitOfWork<ApplicationUnitOfWorkContext>;

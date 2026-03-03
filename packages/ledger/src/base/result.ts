import type { DomainError } from './domain-error';

export type Result<T, E extends DomainError> = Ok<T> | Err<E>;

export class Ok<T> {
  public readonly ok = true as const;

  public constructor(public readonly value: T) {}
}

export class Err<E extends DomainError> {
  public readonly ok = false as const;

  public constructor(public readonly error: E) {}
}

export const Result = {
  ok: <T>(value: T): Ok<T> => new Ok(value),
  err: <E extends DomainError>(error: E): Err<E> => new Err(error),
};

export abstract class DomainError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;

  protected constructor(
    message: string,
    code: string,
    statusOrOptions?: number | ErrorOptions,
    options?: ErrorOptions,
  ) {
    const httpStatus = typeof statusOrOptions === 'number' ? statusOrOptions : 400;
    const errorOptions = typeof statusOrOptions === 'number' ? options : statusOrOptions;

    super(message, errorOptions);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type DomainErrorLike = Error & {
  readonly code: string;
  readonly httpStatus: number;
};

export const isDomainError = (error: unknown): error is DomainErrorLike => {
  if (!(error instanceof Error)) {
    return false;
  }
  const candidate = error as Partial<DomainErrorLike>;
  return (
    typeof candidate.code === 'string' &&
    candidate.code.length > 0 &&
    typeof candidate.httpStatus === 'number' &&
    Number.isInteger(candidate.httpStatus) &&
    candidate.httpStatus >= 400 &&
    candidate.httpStatus <= 599
  );
};

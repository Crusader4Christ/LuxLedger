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
    const errorOptions =
      typeof statusOrOptions === 'number' ? options : statusOrOptions;

    super(message, errorOptions);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

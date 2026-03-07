export abstract class DomainError extends Error {
  public readonly code: string;

  protected constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

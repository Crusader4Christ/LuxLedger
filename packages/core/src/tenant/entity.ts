export class TenantEntity {
  public readonly id: string;
  public readonly name: string;
  public readonly createdAt: Date;

  public constructor(input: { id: string; name: string; createdAt: Date }) {
    this.id = input.id;
    this.name = input.name;
    this.createdAt = input.createdAt;
  }
}

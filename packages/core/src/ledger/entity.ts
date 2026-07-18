export class LedgerEntity {
  public readonly id: string;
  public readonly tenantId: string;
  public readonly name: string;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  public constructor(input: {
    id: string;
    tenantId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.id = input.id;
    this.tenantId = input.tenantId;
    this.name = input.name;
    this.createdAt = input.createdAt;
    this.updatedAt = input.updatedAt;
  }
}

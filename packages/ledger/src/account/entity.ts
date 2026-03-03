export class AccountEntity {
  public readonly id: string;
  public readonly tenantId: string;
  public readonly ledgerId: string;
  public readonly name: string;
  public readonly currency: string;
  public readonly balanceMinor: bigint;
  public readonly createdAt: Date;

  public constructor(input: {
    id: string;
    tenantId: string;
    ledgerId: string;
    name: string;
    currency: string;
    balanceMinor: bigint;
    createdAt: Date;
  }) {
    this.id = input.id;
    this.tenantId = input.tenantId;
    this.ledgerId = input.ledgerId;
    this.name = input.name;
    this.currency = input.currency;
    this.balanceMinor = input.balanceMinor;
    this.createdAt = input.createdAt;
  }
}

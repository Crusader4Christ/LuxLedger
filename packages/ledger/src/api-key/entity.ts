export const ApiKeyRole = {
  ADMIN: 'ADMIN',
  SERVICE: 'SERVICE',
} as const;

export type ApiKeyRole = (typeof ApiKeyRole)[keyof typeof ApiKeyRole];

export class ApiKeyEntity {
  public readonly id: string;
  public readonly tenantId: string;
  public readonly name: string;
  public readonly role: ApiKeyRole;
  public readonly keyHash: string;
  public readonly createdAt: Date;
  public readonly revokedAt: Date | null;

  public constructor(input: {
    id: string;
    tenantId: string;
    name: string;
    role: ApiKeyRole;
    keyHash: string;
    createdAt: Date;
    revokedAt: Date | null;
  }) {
    this.id = input.id;
    this.tenantId = input.tenantId;
    this.name = input.name;
    this.role = input.role;
    this.keyHash = input.keyHash;
    this.createdAt = input.createdAt;
    this.revokedAt = input.revokedAt;
  }
}

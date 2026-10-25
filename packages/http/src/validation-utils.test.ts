import { describe, expect, it } from 'bun:test';
import { isUuid, parseUuidParam } from './validation-utils';

describe('UUID request parameter validation', () => {
  it('accepts existing UUIDv4 and generated UUIDv7 identifiers', () => {
    expect(isUuid('00000000-0000-4000-8000-000000000001')).toBeTrue();
    expect(isUuid('01900000-0000-7000-8000-000000000001')).toBeTrue();
    expect(parseUuidParam('01900000-0000-7000-8000-000000000001', 'id')).toEqual({
      id: '01900000-0000-7000-8000-000000000001',
    });
  });

  it('rejects malformed UUIDs, unsupported versions and invalid variants', () => {
    for (const value of [
      'not-a-uuid',
      '00000000-0000-9000-8000-000000000001',
      '00000000-0000-4000-7000-000000000001',
      '00000000000040008000000000000001',
    ]) {
      expect(isUuid(value)).toBeFalse();
      expect(parseUuidParam(value, 'id')).toBeNull();
    }
  });
});

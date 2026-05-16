import { expect, test } from 'bun:test';
import * as publicApi from './index';

test('public API exports only supported surface', () => {
  expect(Object.keys(publicApi).sort()).toEqual([
    'defaultErrorResponses',
    'errorResponseSchema',
    'mapDomainErrorToHttp',
  ]);
});

import { InvalidTransactionMetadataError } from './errors';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export type TransactionMetadata = JsonObject;

const invalidMetadata = (path: string, reason: string): InvalidTransactionMetadataError =>
  new InvalidTransactionMetadataError(`${path} ${reason}`);

const validateJsonValue = (value: unknown, path: string, ancestors: WeakSet<object>): void => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw invalidMetadata(path, 'must be a finite number');
    }
    return;
  }

  if (typeof value !== 'object') {
    throw invalidMetadata(path, 'must contain JSON values only');
  }

  if (ancestors.has(value)) {
    throw invalidMetadata(path, 'must not contain circular references');
  }

  const prototype = Object.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  if (
    isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
  ) {
    throw invalidMetadata(path, 'must contain plain objects and arrays only');
  }

  ancestors.add(value);
  try {
    if (isArray) {
      const input = value as unknown[];
      const keys = Reflect.ownKeys(input);
      if (
        keys.some((key) => {
          if (key === 'length') {
            return false;
          }
          if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)) {
            return true;
          }
          const index = Number(key);
          return !Number.isSafeInteger(index) || index >= input.length || String(index) !== key;
        })
      ) {
        throw invalidMetadata(path, 'must not contain non-JSON array properties');
      }

      for (let index = 0; index < input.length; index += 1) {
        if (!Object.hasOwn(input, index)) {
          throw invalidMetadata(`${path}[${index}]`, 'must not be sparse');
        }
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw invalidMetadata(`${path}[${index}]`, 'must be an enumerable data value');
        }
        validateJsonValue(descriptor.value, `${path}[${index}]`, ancestors);
      }
      return;
    }

    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      if (typeof key !== 'string') {
        throw invalidMetadata(path, 'must not contain symbol keys');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw invalidMetadata(`${path}.${key}`, 'must be an enumerable data value');
      }
      validateJsonValue(descriptor.value, `${path}.${key}`, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
};

export function validateTransactionMetadata(value: unknown): asserts value is TransactionMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidMetadata('metadata', 'must be a non-null JSON object');
  }
  validateJsonValue(value, 'metadata', new WeakSet());
}

const canonicalizeJsonValue = (value: JsonValue): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJsonValue).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const objectValue = value as JsonObject;
    return `{${Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJsonValue(objectValue[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export const canonicalizeTransactionMetadata = (metadata: TransactionMetadata): string => {
  validateTransactionMetadata(metadata);
  return canonicalizeJsonValue(metadata);
};

export const transactionMetadataEquals = (
  left: TransactionMetadata | undefined,
  right: TransactionMetadata | undefined,
): boolean => {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return canonicalizeTransactionMetadata(left) === canonicalizeTransactionMetadata(right);
};

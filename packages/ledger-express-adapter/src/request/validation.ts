import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validators = new Map<object, ValidateFunction>();

export const validate = <T>(schema: object, value: unknown): T | null => {
  const validator = validators.get(schema) ?? ajv.compile(schema);
  if (!validators.has(schema)) {
    validators.set(schema, validator);
  }
  return validator(value) ? (value as T) : null;
};

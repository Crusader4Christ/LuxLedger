import { YAML } from 'bun';

type JsonRecord = Record<string, unknown>;

export type OpenApiDocument = JsonRecord & {
  paths: Record<string, Record<string, JsonRecord>>;
  components: {
    schemas: Record<string, JsonRecord>;
    parameters: Record<string, JsonRecord>;
  };
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const parseOpenApiDocument = (source: string): OpenApiDocument => {
  const document = YAML.parse(source);
  if (!isRecord(document) || !isRecord(document.paths) || !isRecord(document.components)) {
    throw new Error('Invalid OpenAPI document');
  }
  return document as OpenApiDocument;
};

const resolveRef = (document: OpenApiDocument, value: unknown): unknown => {
  if (!isRecord(value) || typeof value.$ref !== 'string') {
    return value;
  }
  const segments = value.$ref.replace(/^#\//, '').split('/');
  let resolved: unknown = document;
  for (const segment of segments) {
    if (!isRecord(resolved)) {
      throw new Error(`Invalid OpenAPI reference: ${value.$ref}`);
    }
    resolved = resolved[segment];
  }
  return resolveRef(document, resolved);
};

const SCHEMA_KEYWORDS = [
  'type',
  'format',
  'pattern',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'nullable',
  'default',
  'const',
  'additionalProperties',
] as const;

export const normalizeSchema = (document: OpenApiDocument, schema: unknown): unknown => {
  const resolved = resolveRef(document, schema);
  if (!isRecord(resolved)) {
    return resolved;
  }

  const normalized: JsonRecord = {};
  for (const keyword of SCHEMA_KEYWORDS) {
    const value = resolved[keyword];
    if (value !== undefined) {
      normalized[keyword] =
        keyword === 'additionalProperties' && isRecord(value)
          ? normalizeSchema(document, value)
          : value;
    }
  }
  if (Array.isArray(resolved.required)) {
    normalized.required = [...resolved.required].sort();
  }
  if (Array.isArray(resolved.enum)) {
    normalized.enum = [...resolved.enum].sort();
  }
  if (resolved.items !== undefined) {
    normalized.items = normalizeSchema(document, resolved.items);
  }
  if (isRecord(resolved.properties)) {
    normalized.properties = Object.fromEntries(
      Object.entries(resolved.properties)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, property]) => [name, normalizeSchema(document, property)]),
    );
  }
  return normalized;
};

export const componentSchema = (document: OpenApiDocument, name: string): unknown => {
  const schema = document.components.schemas[name];
  if (schema === undefined) {
    throw new Error(`OpenAPI schema not found: ${name}`);
  }
  return schema;
};

const operation = (document: OpenApiDocument, path: string, method: string): JsonRecord => {
  const operationValue = document.paths[path]?.[method];
  if (!isRecord(operationValue)) {
    throw new Error(`OpenAPI operation not found: ${method.toUpperCase()} ${path}`);
  }
  return operationValue;
};

export const requestBodySchema = (
  document: OpenApiDocument,
  path: string,
  method: string,
): unknown => {
  const requestBody = operation(document, path, method).requestBody;
  if (!isRecord(requestBody) || !isRecord(requestBody.content)) {
    throw new Error(`OpenAPI request body not found: ${method.toUpperCase()} ${path}`);
  }
  const mediaType = requestBody.content['application/json'];
  if (!isRecord(mediaType)) {
    throw new Error(`OpenAPI JSON request body not found: ${method.toUpperCase()} ${path}`);
  }
  return mediaType.schema;
};

export const responseSchema = (
  document: OpenApiDocument,
  path: string,
  method: string,
  status: number,
): unknown => {
  const responses = operation(document, path, method).responses;
  const response = isRecord(responses) ? responses[String(status)] : undefined;
  if (!isRecord(response) || !isRecord(response.content)) {
    throw new Error(`OpenAPI response not found: ${method.toUpperCase()} ${path} ${status}`);
  }
  const mediaType = response.content['application/json'];
  if (!isRecord(mediaType)) {
    throw new Error(`OpenAPI JSON response not found: ${method.toUpperCase()} ${path} ${status}`);
  }
  return mediaType.schema;
};

export const successStatuses = (
  document: OpenApiDocument,
  path: string,
  method: string,
): number[] => {
  const responses = operation(document, path, method).responses;
  if (!isRecord(responses)) {
    return [];
  }
  return Object.keys(responses)
    .filter((status) => /^2\d\d$/.test(status))
    .map(Number)
    .sort((left, right) => left - right);
};

export const parametersSchema = (
  document: OpenApiDocument,
  path: string,
  method: string,
  location: 'path' | 'query',
): JsonRecord => {
  const parameters = operation(document, path, method).parameters;
  const properties: JsonRecord = {};
  const required: string[] = [];
  for (const parameterValue of Array.isArray(parameters) ? parameters : []) {
    const parameter = resolveRef(document, parameterValue);
    if (!isRecord(parameter) || parameter.in !== location || typeof parameter.name !== 'string') {
      continue;
    }
    properties[parameter.name] = parameter.schema;
    if (parameter.required === true) {
      required.push(parameter.name);
    }
  }
  return {
    type: 'object',
    additionalProperties: false,
    ...(required.length === 0 ? {} : { required }),
    properties,
  };
};

export const normalizeList = (value: string): string[] =>
  value
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .sort();

export const extractPathMethodSection = (
  openapiYaml: string,
  path: string,
  method: string,
): string => {
  const pathMatch = openapiYaml.match(new RegExp(`^\\s*${path}:\\s*$`, 'm'));
  if (!pathMatch || pathMatch.index === undefined) {
    throw new Error(`OpenAPI path not found: ${path}`);
  }

  const fromPath = openapiYaml.slice(pathMatch.index);
  const pathHeaderMatch = fromPath.match(/^\s*\/v1\/[^\n]+:\s*$/m);
  const pathHeaderLength = pathHeaderMatch?.[0].length ?? 0;
  const pathBody = fromPath.slice(pathHeaderLength);

  const methodMatch = pathBody.match(new RegExp(`^\\s*${method}:\\s*$`, 'm'));
  if (!methodMatch || methodMatch.index === undefined) {
    throw new Error(`OpenAPI method not found: ${method} under ${path}`);
  }

  const sectionStart =
    pathMatch.index + pathHeaderLength + methodMatch.index + methodMatch[0].length;
  const tail = openapiYaml.slice(sectionStart);
  const endMatch = tail.match(/\n\s*\/v1\/[^\n]+:\s*$/m);
  const end = endMatch?.index ?? tail.length;
  return tail.slice(0, end);
};

export const extractSchemaSection = (openapiYaml: string, schemaName: string): string => {
  const startMatch = openapiYaml.match(new RegExp(`^\\s{4}${schemaName}:\\s*$`, 'm'));
  if (!startMatch || startMatch.index === undefined) {
    throw new Error(`OpenAPI schema not found: ${schemaName}`);
  }

  const tail = openapiYaml.slice(startMatch.index + startMatch[0].length);
  const endMatch = tail.match(/\n\s{4}[A-Za-z0-9_]+:\s*$/m);
  const end = endMatch?.index ?? tail.length;
  return tail.slice(0, end);
};

export const extractRequiredList = (section: string): string[] => {
  const match = section.match(/required:\s*\[([^\]]+)\]/);
  if (!match) {
    throw new Error('required list not found in OpenAPI section');
  }
  return normalizeList(match[1]);
};

export const extractPropertyNames = (section: string): string[] => {
  const propertiesIndex = section.indexOf('properties:');
  if (propertiesIndex === -1) {
    throw new Error('properties block not found in OpenAPI section');
  }

  const afterProperties = section.slice(propertiesIndex);
  const names = [...afterProperties.matchAll(/^\s{8}([A-Za-z_]+):\s*$/gm)].map(
    (match) => match[1] ?? '',
  );
  return names.filter((name) => name.length > 0).sort();
};

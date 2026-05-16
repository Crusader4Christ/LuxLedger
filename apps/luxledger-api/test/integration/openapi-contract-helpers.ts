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
  const names = [...afterProperties.matchAll(/^\s{8}([a-z_]+):\s*$/gm)].map(
    (match) => match[1] ?? '',
  );
  return names.filter((name) => name.length > 0).sort();
};

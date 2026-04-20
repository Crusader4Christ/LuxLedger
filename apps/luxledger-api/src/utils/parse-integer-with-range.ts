interface ParseIntegerWithinRangeOptions {
  defaultValue: number;
  min?: number;
  max?: number;
  errorMessage: string;
}

export const parseIntegerWithinRange = (
  value: string | undefined,
  options: ParseIntegerWithinRangeOptions,
): number => {
  if (value === undefined) {
    return options.defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(options.errorMessage);
  }

  if (options.min !== undefined && parsed < options.min) {
    throw new Error(options.errorMessage);
  }

  if (options.max !== undefined && parsed > options.max) {
    throw new Error(options.errorMessage);
  }

  return parsed;
};

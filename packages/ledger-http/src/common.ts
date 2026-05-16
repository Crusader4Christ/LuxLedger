export const NON_EMPTY_TRIMMED_PATTERN = '^(?=.*\\S).+$';

export const NonEmptyTrimmedStringSchema = {
  type: 'string',
  pattern: NON_EMPTY_TRIMMED_PATTERN,
} as const;

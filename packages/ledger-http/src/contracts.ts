export type ErrorResponse = {
  error: string;
  message: string;
};

export const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'message'],
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
  },
} as const;

import type { FastifyReply } from 'fastify';

interface ErrorWithCodeAndStatus {
  code: string;
  httpStatus: number;
  message: string;
}

const isErrorWithCodeAndStatus = (error: unknown): error is ErrorWithCodeAndStatus =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof (error as { code: unknown }).code === 'string' &&
  'httpStatus' in error &&
  typeof (error as { httpStatus: unknown }).httpStatus === 'number' &&
  'message' in error &&
  typeof (error as { message: unknown }).message === 'string';

const isErrorWithCode = (error: unknown): error is { code: string; message: string } =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof (error as { code: unknown }).code === 'string' &&
  'message' in error &&
  typeof (error as { message: unknown }).message === 'string';

const parseHttpStatusFromCode = (code: string): number | null => {
  if (!/^\d{3}$/.test(code)) {
    return null;
  }

  const status = Number(code);
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    return null;
  }

  return status;
};

export const sendDomainError = (reply: FastifyReply, error: unknown): FastifyReply => {
  if (isErrorWithCodeAndStatus(error)) {
    return reply.status(error.httpStatus).send({
      error: error.code,
      message: error.message,
    });
  }

  if (isErrorWithCode(error)) {
    const statusFromCode = parseHttpStatusFromCode(error.code);

    return reply.status(statusFromCode ?? 500).send({
      error: error.code,
      message: error.message,
    });
  }

  return reply.status(500).send({
    error: 'INTERNAL_ERROR',
    message: 'Internal server error',
  });
};

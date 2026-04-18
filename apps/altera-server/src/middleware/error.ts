import { AlteraError, ERROR_CODES } from '@altera/core';
import type { Context, ErrorHandler } from 'hono';
import { ZodError } from 'zod';

export const errorHandler: ErrorHandler = (err, c: Context) => {
  if (err instanceof AlteraError) {
    return c.json(err.toJSON(), err.status as never);
  }

  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Validation failed',
          details: err.issues,
        },
      },
      400,
    );
  }

  console.error('[error]', err);
  const maybeStatus = (err as unknown as { status?: unknown }).status;
  const status = typeof maybeStatus === 'number' ? maybeStatus : 500;

  return c.json(
    {
      error: {
        code: ERROR_CODES.INTERNAL,
        message: err instanceof Error ? err.message : 'Internal server error',
      },
    },
    status as never,
  );
};

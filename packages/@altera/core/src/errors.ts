export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorShape {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export class AlteraError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status = 500, details?: unknown) {
    super(message);
    this.name = 'AlteraError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON(): ApiErrorShape {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export const unauthorized = (message = 'Not authenticated', details?: unknown) =>
  new AlteraError(ERROR_CODES.UNAUTHORIZED, message, 401, details);

export const forbidden = (message = 'Forbidden', details?: unknown) =>
  new AlteraError(ERROR_CODES.FORBIDDEN, message, 403, details);

export const notFound = (message = 'Not found', details?: unknown) =>
  new AlteraError(ERROR_CODES.NOT_FOUND, message, 404, details);

export const validationError = (message = 'Validation failed', details?: unknown) =>
  new AlteraError(ERROR_CODES.VALIDATION_ERROR, message, 400, details);

export const conflict = (message = 'Conflict', details?: unknown) =>
  new AlteraError(ERROR_CODES.CONFLICT, message, 409, details);

export const rateLimited = (message = 'Too many requests', details?: unknown) =>
  new AlteraError(ERROR_CODES.RATE_LIMITED, message, 429, details);

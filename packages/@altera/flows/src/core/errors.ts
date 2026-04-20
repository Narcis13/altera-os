export class FlowError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
    public stepId?: string,
  ) {
    super(message);
    this.name = 'FlowError';
  }
}

export function createFailure(
  code: string,
  message: string,
  details?: unknown,
  stepId?: string,
): FlowError {
  return new FlowError(code, message, details, stepId);
}

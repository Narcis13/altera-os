export class DocsError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DocsError';
  }
}

export class UnknownComponentTypeError extends DocsError {
  constructor(type: string) {
    super('UNKNOWN_COMPONENT_TYPE', `Unknown component type: ${type}`, { type });
  }
}

export class InvalidDocumentDefinitionError extends DocsError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INVALID_DOCUMENT_DEFINITION', message, details);
  }
}

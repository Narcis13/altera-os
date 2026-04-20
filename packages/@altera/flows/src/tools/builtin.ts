import { renderDocument } from '@altera/docs';
import { type FlowTool, defineFlowTools } from './contracts.ts';

const echoTool: FlowTool = {
  name: 'echo',
  description: 'Echoes its input payload as output. Useful for testing.',
  inputSchema: { type: 'object', additionalProperties: true },
  sideEffect: 'none',
  execute: async (input) => ({ ok: true, output: input }),
};

const fetchTool: FlowTool = {
  name: 'fetch',
  description: 'HTTP fetch with GET/POST. Returns { status, body }.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      method: { type: 'string' },
      headers: { type: 'object' },
      body: {},
    },
    required: ['url'],
  },
  sideEffect: 'external',
  execute: async (input) => {
    const {
      url,
      method = 'GET',
      headers,
      body,
    } = input as {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    };
    try {
      const res = await fetch(url, {
        method,
        ...(headers ? { headers } : {}),
        ...(body != null ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      let parsedBody: unknown = text;
      try {
        parsedBody = JSON.parse(text);
      } catch {
        // keep as text
      }
      return {
        ok: true,
        output: {
          status: res.status,
          body: parsedBody as never,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'TOOL_RUNTIME_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  },
};

const renderDocumentTool: FlowTool = {
  name: 'render-document',
  description: 'Renders a docraftr DocumentDefinition with data and returns HTML.',
  inputSchema: {
    type: 'object',
    properties: {
      definition: { type: 'object' },
      data: { type: 'object' },
    },
    required: ['definition'],
  },
  sideEffect: 'none',
  execute: async (input) => {
    const { definition, data } = input as {
      definition: unknown;
      data?: Record<string, unknown>;
    };
    try {
      const result = renderDocument(definition as never, (data ?? {}) as Record<string, unknown>);
      return {
        ok: true,
        output: {
          html: result.html,
          errors: result.errors as never,
          rendered: result.rendered_components as never,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'TOOL_RUNTIME_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  },
};

export function createBuiltinFlowTools() {
  return defineFlowTools([echoTool, fetchTool, renderDocumentTool]);
}

import { afterEach, describe, expect, test } from 'bun:test';
import { clearRegistry } from '../core/registry.ts';
import type { DocumentDefinition } from '../core/types.ts';
import { registerReadOnlyComponents } from '../components/index.ts';
import { renderDocument } from './render.ts';

afterEach(() => clearRegistry());

describe('renderDocument', () => {
  test('renders a simple report document to HTML', () => {
    registerReadOnlyComponents();

    const def: DocumentDefinition = {
      id: 'doc-1',
      version: 1,
      title: 'Monthly Report',
      kind: 'report',
      sections: [
        {
          id: 'intro',
          components: [
            {
              id: 'title',
              type: 'heading',
              mode: 'read',
              bind: { content: 'title' },
              props: { level: 1 },
            },
            {
              id: 'summary',
              type: 'text',
              mode: 'read',
              bind: { content: 'summary' },
            },
          ],
        },
      ],
    };

    const result = renderDocument(def, {
      title: 'April Report',
      summary: 'All metrics are up.',
    });

    expect(typeof result.html).toBe('string');
    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).toContain('April Report');
    expect(result.html).toContain('All metrics are up.');
    expect(result.errors.length).toBe(0);
    expect(result.rendered_components).toContain('title');
    expect(result.rendered_components).toContain('summary');
  });

  test('flags unknown component types as render errors', () => {
    registerReadOnlyComponents();
    const def: DocumentDefinition = {
      id: 'doc-1',
      version: 1,
      title: 'x',
      kind: 'report',
      sections: [
        {
          id: 's',
          components: [
            {
              id: 'bad',
              type: 'nonexistent',
              mode: 'read',
            },
          ],
        },
      ],
    };

    const result = renderDocument(def, {});
    expect(result.errors[0]?.code).toBe('UNKNOWN_COMPONENT_TYPE');
  });

  test('skips sections when skip_when is true', () => {
    registerReadOnlyComponents();
    const def: DocumentDefinition = {
      id: 'd',
      version: 1,
      title: 'x',
      kind: 'report',
      sections: [
        {
          id: 'hidden',
          skip_when: { field: 'hide', op: 'eq', value: true },
          components: [
            {
              id: 't',
              type: 'text',
              mode: 'read',
              bind: { content: 'content' },
            },
          ],
        },
      ],
    };

    const result = renderDocument(def, { hide: true, content: 'should not appear' });
    expect(result.rendered_components.length).toBe(0);
    expect(result.skipped_components).toContain('t');
    expect(result.html).not.toContain('should not appear');
  });
});

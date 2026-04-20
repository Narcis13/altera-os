import type { ComponentTypeDefinition } from '../core/types.ts';
import { escapeHtml, toString } from './utils.ts';

export const textComponent: ComponentTypeDefinition = {
  type: 'text',
  label: 'Text',
  description: 'Inline text block',
  agentHint: 'Use for short text. Bind: { content: "path.to.text" }',
  mode: 'read',
  validate: () => [],
  renderLoom: (data) => `<span data-ui="text">${escapeHtml(toString(data.content))}</span>`,
};

export const headingComponent: ComponentTypeDefinition = {
  type: 'heading',
  label: 'Heading',
  description: 'Bold heading text',
  agentHint: 'Use for section titles. Bind: { content: "path.to.title" }. Props: { level?: 1-6 }',
  mode: 'read',
  validate: () => [],
  renderLoom: (data, component) => {
    const content = escapeHtml(toString(data.content));
    const level = (component.props?.level as number) ?? 2;
    const tag = `h${Math.min(Math.max(level, 1), 6)}` as
      | 'h1'
      | 'h2'
      | 'h3'
      | 'h4'
      | 'h5'
      | 'h6';
    const size = level === 1 ? 'xl' : 'lg';
    return `<${tag} data-ui="text" data-size="${size}">${content}</${tag}>`;
  },
};

function sanitizeRichText(html: string): string {
  return html.replace(
    /<(?!\/?(?:p|br|strong|em|b|i|u|ul|ol|li|a|h[1-6]|blockquote|code|pre|span)(?=[\s>\/]))[^>]*>/gi,
    '',
  );
}

export const richTextComponent: ComponentTypeDefinition = {
  type: 'rich-text',
  label: 'Rich Text',
  description: 'Formatted text with a limited safe HTML subset',
  agentHint:
    'Use for formatted paragraphs with emphasis, links, and lists. Bind: { content: "path.to.html" }',
  mode: 'read',
  validate: () => [],
  renderLoom: (data) => {
    const raw = toString(data.content);
    return `<div data-ui="text" data-variant="rich">${sanitizeRichText(raw)}</div>`;
  },
};

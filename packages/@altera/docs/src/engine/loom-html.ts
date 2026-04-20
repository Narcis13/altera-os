import { embedLoomCss, embedLoomJs } from '@altera/loom';
import type { DocumentTheme } from '../core/types.ts';
import { themeToTokenOverrides } from './tokens.ts';

export interface LoomDocumentOptions {
  title: string;
  variant?: string;
  interactive?: boolean;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function assembleLoomDocument(
  sectionHtml: string[],
  theme: DocumentTheme | undefined,
  options: LoomDocumentOptions,
): string {
  const { title, variant, interactive } = options;
  const tokenOverrides = themeToTokenOverrides(theme);
  const variantAttr = variant ? ` data-variant="${variant}"` : '';
  const loomJsTag = interactive ? embedLoomJs() : '';

  return `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${embedLoomCss()}
  ${tokenOverrides ? `<style>\n${tokenOverrides}\n</style>` : ''}
</head>
<body>
  <div data-ui="document"${variantAttr}>
    <div data-part="body">
      ${sectionHtml.join('\n      ')}
    </div>
  </div>
  ${loomJsTag}
</body>
</html>`;
}

export function assembleLoomSection(
  componentHtml: string[],
  layout: 'stack' | 'columns' = 'stack',
  columns?: number,
): string {
  if (layout === 'columns') {
    const cols = columns ?? 2;
    return `<div data-ui="grid" data-cols="${cols}" data-gap="4">\n  ${componentHtml.join('\n  ')}\n</div>`;
  }
  return `<div data-ui="stack" data-gap="4">\n  ${componentHtml.join('\n  ')}\n</div>`;
}

import { embedLoomCss, embedLoomJs } from '@altera/loom';
import type { DocumentDefinition, DocumentTheme } from '../core/types.ts';
import { themeToTokenOverrides } from './tokens.ts';

export interface LoomFormOptions {
  submitUrl?: string;
  initialData?: Record<string, unknown>;
  successMessage?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

function buildInitialFields(
  definition: DocumentDefinition,
  initialData: Record<string, unknown>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const section of definition.sections) {
    for (const comp of section.components) {
      if (comp.mode === 'input') {
        const fallback =
          comp.type === 'multi_select' ? [] : comp.type === 'checkbox' ? false : '';
        fields[comp.id] = initialData[comp.id] ?? comp.default_value ?? fallback;
      }
    }
  }
  return { ...fields, ...initialData };
}

export function assembleLoomForm(
  definition: DocumentDefinition,
  sectionHtml: string[],
  theme: DocumentTheme | undefined,
  options: LoomFormOptions = {},
): string {
  const {
    submitUrl = '',
    initialData = {},
    successMessage = 'Formular trimis cu succes!',
  } = options;

  const tokenOverrides = themeToTokenOverrides(theme);
  const title = definition.title;
  const submitLabel = definition.settings?.submit_label ?? 'Trimite';

  const fields = buildInitialFields(definition, initialData);
  const stateJson = escapeAttr(
    JSON.stringify({ fields, submitting: false, submitted: false, error: '' }),
  );

  return `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  ${embedLoomCss()}
  <style>${tokenOverrides ?? ''}</style>
</head>
<body>
  <div data-ui="document" data-variant="form" l-data='${stateJson}'>
    <div data-part="header">
      <h1 data-ui="text" data-size="xl" data-weight="bold">${escapeHtml(title)}</h1>
    </div>
    <form data-part="body" l-on:submit.prevent="submitForm($el, $scope)">
      ${sectionHtml.join('\n      ')}
      <div l-show="error" data-ui="callout" data-variant="error"><span l-html="error"></span></div>
      <div l-show="submitted" data-ui="callout" data-variant="success">${escapeHtml(successMessage)}</div>
      <div data-ui="stack" data-variant="horizontal" data-gap="3" data-justify="end">
        <button type="submit" data-ui="button" data-variant="primary" l-bind:disabled="submitting">
          <span l-show="!submitting">${escapeHtml(submitLabel)}</span>
          <span l-show="submitting">Se trimite...</span>
        </button>
      </div>
    </form>
  </div>
  ${embedLoomJs()}
  <script>
  async function submitForm(el, data) {
    if (data.submitting || data.submitted) return;
    data.submitting = true;
    data.error = '';
    try {
      ${
        submitUrl
          ? `const res = await fetch('${submitUrl.replace(/'/g, "\\'")}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.fields),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Eroare la trimitere');
      }`
          : '// No submitUrl configured'
      }
      data.submitted = true;
    } catch (err) {
      data.error = err.message || 'Eroare necunoscuta';
    } finally {
      data.submitting = false;
    }
  }
  </script>
</body>
</html>`;
}

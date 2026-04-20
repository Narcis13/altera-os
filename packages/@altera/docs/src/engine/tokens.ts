import type { DocumentTheme } from '../core/types.ts';

export function themeToTokenOverrides(theme?: DocumentTheme): string {
  if (!theme) return '';

  const tokens: string[] = [];

  if (theme.fontFamily) {
    tokens.push(`--doc-font: ${theme.fontFamily}`);
    tokens.push(`--font-sans: ${theme.fontFamily}`);
  }

  if (theme.fontSize) {
    if (theme.fontSize.base) tokens.push(`--doc-font-size: ${theme.fontSize.base}`);
    if (theme.fontSize.heading)
      tokens.push(`--doc-heading-size: ${theme.fontSize.heading}`);
    if (theme.fontSize.small) tokens.push(`--doc-legal-size: ${theme.fontSize.small}`);
    if (theme.fontSize.label) tokens.push(`--kv-label-size: ${theme.fontSize.label}`);
  }

  if (theme.colors) {
    if (theme.colors.primary) tokens.push(`--color-fg: ${theme.colors.primary}`);
    if (theme.colors.secondary) tokens.push(`--color-fg-muted: ${theme.colors.secondary}`);
    if (theme.colors.accent) tokens.push(`--color-primary: ${theme.colors.accent}`);
    if (theme.colors.border) {
      tokens.push(`--color-border: ${theme.colors.border}`);
      tokens.push(`--doc-table-border: ${theme.colors.border}`);
    }
    if (theme.colors.background) {
      tokens.push(`--color-bg: ${theme.colors.background}`);
      tokens.push(`--doc-bg: ${theme.colors.background}`);
    }
  }

  if (theme.spacing) {
    if (theme.spacing.section) tokens.push(`--doc-section-gap: ${theme.spacing.section}`);
    if (theme.spacing.component)
      tokens.push(`--doc-component-gap: ${theme.spacing.component}`);
    if (theme.spacing.cell) {
      tokens.push(`--doc-table-cell-pad-y: ${theme.spacing.cell}`);
      tokens.push(`--doc-table-cell-pad-x: ${theme.spacing.cell}`);
    }
  }

  if (theme.table) {
    if (theme.table.headerBg)
      tokens.push(`--doc-table-header-bg: ${theme.table.headerBg}`);
    if (theme.table.borderColor)
      tokens.push(`--doc-table-border: ${theme.table.borderColor}`);
  }

  if (theme.page) {
    if (theme.page.format) tokens.push(`--page-format: ${theme.page.format}`);
    if (theme.page.orientation)
      tokens.push(`--page-orientation: ${theme.page.orientation}`);
    if (theme.page.margin) tokens.push(`--page-margin: ${theme.page.margin}`);
  }

  if (tokens.length === 0) return '';
  return `:root {\n  ${tokens.join(';\n  ')};\n}`;
}

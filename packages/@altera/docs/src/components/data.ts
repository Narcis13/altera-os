import type { ComponentTypeDefinition } from '../core/types.ts';
import { escapeHtml, formatCurrency, formatNumber, toString } from './utils.ts';

export const tableComponent: ComponentTypeDefinition = {
  type: 'table',
  label: 'Table',
  description: 'Data table with headers and rows',
  agentHint:
    'Use for tabular data. Bind: { rows: "path.to.array" }. Props: { columns: [{ key, label, align?, format? }] }',
  mode: 'read',
  validate: (data, component) => {
    if (!Array.isArray(data.rows))
      return [
        {
          component_id: component.id,
          code: 'INVALID_ROWS',
          message: 'Table requires rows as array',
        },
      ];
    return [];
  },
  renderLoom: (data, component) => {
    const rows = data.rows as Array<Record<string, unknown>>;
    const columns =
      (component.props?.columns as Array<{
        key: string;
        label: string;
        align?: string;
        format?: string;
      }>) ?? [];

    if (columns.length === 0) return '<div>No columns defined</div>';

    const headerCells = columns
      .map(
        (col) =>
          `<th data-part="th" data-align="${col.align ?? 'left'}">${escapeHtml(col.label)}</th>`,
      )
      .join('');

    const bodyRows = rows
      .map((row, idx) => {
        const striped = idx % 2 === 1 ? ' data-striped' : '';
        const cells = columns
          .map((col) => {
            let val = row[col.key];
            if (col.format === 'currency' && typeof val === 'number')
              val = formatCurrency(val);
            else if (col.format === 'number' && typeof val === 'number')
              val = formatNumber(val);
            return `<td data-part="td" data-align="${col.align ?? 'left'}">${escapeHtml(toString(val))}</td>`;
          })
          .join('');
        return `<tr data-part="tr"${striped}>${cells}</tr>`;
      })
      .join('');

    return `<div data-ui="table"><table><thead data-part="thead"><tr data-part="tr">${headerCells}</tr></thead><tbody data-part="tbody">${bodyRows}</tbody></table></div>`;
  },
};

export const kpiGridComponent: ComponentTypeDefinition = {
  type: 'kpi-grid',
  label: 'KPI Grid',
  description: 'Grid of key metrics with label, value, and optional delta',
  agentHint:
    'Use for dashboards. Bind: { items: "path.to.array" }. Each: { label, value, unit?, delta?, deltaDirection? }. Props: { columns?: 2-4 }',
  mode: 'read',
  validate: (data, component) => {
    if (!Array.isArray(data.items))
      return [
        {
          component_id: component.id,
          code: 'INVALID_ITEMS',
          message: 'KPI grid requires items as array',
        },
      ];
    return [];
  },
  renderLoom: (data, component) => {
    const items = data.items as Array<{
      label: string;
      value: unknown;
      unit?: string;
      delta?: number;
      deltaDirection?: 'up' | 'down' | 'flat';
    }>;
    const cols = Math.min(Math.max((component.props?.columns as number) ?? 3, 1), 6);

    const cards = items
      .map((item) => {
        const valueText =
          typeof item.value === 'number' ? formatNumber(item.value) : toString(item.value);
        const unitHtml = item.unit
          ? `<span data-ui="text" data-size="sm" data-variant="muted"> ${escapeHtml(item.unit)}</span>`
          : '';
        let deltaHtml = '';
        if (typeof item.delta === 'number') {
          const dir =
            item.deltaDirection ?? (item.delta > 0 ? 'up' : item.delta < 0 ? 'down' : 'flat');
          const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
          deltaHtml = `<div data-ui="badge" data-variant="${dir}">${arrow} ${formatNumber(
            item.delta,
          )}</div>`;
        }
        return `<div data-ui="card"><div data-part="body"><div data-ui="stack" data-gap="1">
          <div data-ui="text" data-size="sm" data-variant="muted">${escapeHtml(toString(item.label))}</div>
          <div data-ui="text" data-size="xl" data-variant="strong">${escapeHtml(valueText)}${unitHtml}</div>
          ${deltaHtml}
        </div></div></div>`;
      })
      .join('');

    return `<div data-ui="grid" data-cols="${cols}" data-gap="4">${cards}</div>`;
  },
};

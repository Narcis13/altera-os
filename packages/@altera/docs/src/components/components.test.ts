import { afterEach, describe, expect, test } from 'bun:test';
import { clearRegistry } from '../core/registry.ts';
import type { DocumentComponent, DocumentTheme } from '../core/types.ts';
import {
  chartComponent,
  companyBlockComponent,
  headingComponent,
  invoiceBlockComponent,
  kpiGridComponent,
  richTextComponent,
  tableComponent,
  textComponent,
} from './index.ts';

const theme: DocumentTheme = {};

function makeComp(
  id: string,
  type: string,
  extra: Partial<DocumentComponent> = {},
): DocumentComponent {
  return { id, type, mode: 'read', ...extra };
}

afterEach(() => {
  clearRegistry();
});

describe('text component', () => {
  test('renders inline text with HTML escape', () => {
    const html = textComponent.renderLoom(
      { content: 'Hello <world>' },
      makeComp('t1', 'text'),
      theme,
    );
    expect(html).toContain('Hello &lt;world&gt;');
    expect(html).toContain('data-ui="text"');
  });
});

describe('heading component', () => {
  test('defaults to h2', () => {
    const html = headingComponent.renderLoom(
      { content: 'Title' },
      makeComp('h1', 'heading'),
      theme,
    );
    expect(html).toMatch(/^<h2/);
    expect(html).toContain('Title');
  });

  test('respects props.level', () => {
    const html = headingComponent.renderLoom(
      { content: 'Big' },
      makeComp('h1', 'heading', { props: { level: 1 } }),
      theme,
    );
    expect(html).toMatch(/^<h1/);
  });
});

describe('rich-text component', () => {
  test('keeps allowed tags', () => {
    const html = richTextComponent.renderLoom(
      { content: '<p>Hello <strong>world</strong></p>' },
      makeComp('rt', 'rich-text'),
      theme,
    );
    expect(html).toContain('<p>');
    expect(html).toContain('<strong>');
  });

  test('strips disallowed tags', () => {
    const html = richTextComponent.renderLoom(
      { content: '<script>alert(1)</script><p>ok</p>' },
      makeComp('rt', 'rich-text'),
      theme,
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('<p>ok</p>');
  });
});

describe('table component', () => {
  test('renders rows and columns', () => {
    const html = tableComponent.renderLoom(
      {
        rows: [
          { name: 'A', qty: 1 },
          { name: 'B', qty: 2 },
        ],
      },
      makeComp('tbl', 'table', {
        props: {
          columns: [
            { key: 'name', label: 'Name' },
            { key: 'qty', label: 'Qty', align: 'right' },
          ],
        },
      }),
      theme,
    );
    expect(html).toContain('<th');
    expect(html).toContain('Name');
    expect(html).toContain('Qty');
    expect(html).toContain('<td');
  });

  test('validate requires rows to be array', () => {
    const errors = tableComponent.validate(
      { rows: 'not-an-array' as unknown as Record<string, unknown> },
      makeComp('tbl', 'table'),
    );
    expect(errors.length).toBe(1);
    expect(errors[0]?.code).toBe('INVALID_ROWS');
  });
});

describe('kpi-grid component', () => {
  test('renders cards', () => {
    const html = kpiGridComponent.renderLoom(
      {
        items: [
          { label: 'Revenue', value: 100 },
          { label: 'Orders', value: 42, delta: -3 },
        ],
      },
      makeComp('k', 'kpi-grid'),
      theme,
    );
    expect(html).toContain('data-ui="card"');
    expect(html).toContain('Revenue');
    expect(html).toContain('Orders');
    expect(html).toContain('▼');
  });

  test('validate requires items array', () => {
    const errors = kpiGridComponent.validate(
      {},
      makeComp('k', 'kpi-grid'),
    );
    expect(errors.length).toBe(1);
    expect(errors[0]?.code).toBe('INVALID_ITEMS');
  });
});

describe('company-block component', () => {
  test('renders name and optional fields', () => {
    const html = companyBlockComponent.renderLoom(
      { name: 'Acme SRL', cif: 'RO12345', address: 'Bucuresti' },
      makeComp('co', 'company-block'),
      theme,
    );
    expect(html).toContain('Acme SRL');
    expect(html).toContain('RO12345');
    expect(html).toContain('Bucuresti');
  });

  test('validate requires name', () => {
    const errors = companyBlockComponent.validate(
      {},
      makeComp('co', 'company-block'),
    );
    expect(errors[0]?.code).toBe('MISSING_NAME');
  });
});

describe('invoice-block component', () => {
  test('renders totals', () => {
    const html = invoiceBlockComponent.renderLoom(
      {
        series: 'FCT',
        number: '001',
        date: '2026-04-20',
        items: [
          { description: 'Svc A', unit: 'h', quantity: 2, unit_price: 100 },
          { description: 'Svc B', unit: 'h', quantity: 1, unit_price: 50 },
        ],
      },
      makeComp('inv', 'invoice-block', { props: { vat_rate: 19 } }),
      theme,
    );
    expect(html).toContain('FCT');
    expect(html).toContain('TOTAL');
    // subtotal 250, vat 47.50, total 297.50
    expect(html).toContain('250');
    expect(html).toContain('297');
  });
});

describe('chart component', () => {
  test('renders SVG for bar chart', () => {
    const html = chartComponent.renderLoom(
      {
        points: [
          { label: 'A', value: 1 },
          { label: 'B', value: 2 },
          { label: 'C', value: 3 },
        ],
      },
      makeComp('c', 'chart'),
      theme,
    );
    expect(html).toContain('<svg');
    expect(html).toContain('<rect');
  });

  test('renders line chart variant', () => {
    const html = chartComponent.renderLoom(
      {
        points: [
          { label: 'A', value: 1 },
          { label: 'B', value: 2 },
        ],
      },
      makeComp('c', 'chart', { variant: 'line' }),
      theme,
    );
    expect(html).toContain('<svg');
    expect(html).toContain('<path');
  });
});

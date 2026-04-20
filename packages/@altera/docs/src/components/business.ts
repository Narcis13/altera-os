import type { ComponentTypeDefinition } from '../core/types.ts';
import { escapeHtml, formatCurrency, formatDate, toString } from './utils.ts';

export const companyBlockComponent: ComponentTypeDefinition = {
  type: 'company-block',
  label: 'Company Block',
  description: 'Romanian company info block (name, CIF, reg com, address, bank)',
  agentHint:
    'Use for supplier/client info. Bind: { name, cif?, reg_com?, address?, iban?, bank?, phone?, email? }',
  mode: 'read',
  validate: (data, component) => {
    if (!data.name)
      return [
        {
          component_id: component.id,
          code: 'MISSING_NAME',
          message: 'Company block requires name',
        },
      ];
    return [];
  },
  renderLoom: (data, component) => {
    const variant = component.variant ?? 'default';
    const nameSize = variant === 'supplier' ? ' data-size="lg"' : '';

    const lines: string[] = [];
    lines.push(
      `<div data-ui="text"${nameSize} data-variant="strong">${escapeHtml(toString(data.name))}</div>`,
    );

    const field = (label: string, value: unknown) => {
      if (!value) return;
      lines.push(
        `<div data-ui="stack" data-variant="horizontal" data-gap="1"><span data-ui="label">${escapeHtml(
          label,
        )}: </span><span data-ui="text">${escapeHtml(toString(value))}</span></div>`,
      );
    };

    field('Reg. Com.', data.reg_com);
    field('CIF', data.cif);
    field('Sediul', data.address);
    field('IBAN', data.iban);
    field('Banca', data.bank);
    field('Tel', data.phone);
    field('Email', data.email);

    return `<div data-ui="card"><div data-part="body"><div data-ui="stack" data-gap="1">${lines.join(
      '\n',
    )}</div></div></div>`;
  },
};

export const invoiceBlockComponent: ComponentTypeDefinition = {
  type: 'invoice-block',
  label: 'Invoice Block',
  description: 'Full invoice rendering with line items, totals, and metadata',
  agentHint:
    'Use for invoices. Bind: { series?, number?, date?, items: "path", vat_rate?, currency? }. items = [{description, unit, quantity, unit_price}]',
  mode: 'read',
  validate: (data, component) => {
    if (!Array.isArray(data.items))
      return [
        {
          component_id: component.id,
          code: 'INVALID_ITEMS',
          message: 'Invoice block requires items as array',
        },
      ];
    return [];
  },
  renderLoom: (data, component) => {
    const items = data.items as Array<{
      description: string;
      unit: string;
      quantity: number;
      unit_price: number;
    }>;
    const vatRate =
      (component.props?.vat_rate as number) ?? (data.vat_rate as number) ?? 19;
    const currency = (component.props?.currency as string) ?? (data.currency as string) ?? 'RON';
    const series = toString(data.series);
    const number = toString(data.number);
    const date = data.date ? formatDate(toString(data.date)) : '';

    const headerRow = `<tr data-part="tr">
      <th data-part="th" data-align="center">Nr.</th>
      <th data-part="th" data-align="left">Denumire</th>
      <th data-part="th" data-align="center">U.M.</th>
      <th data-part="th" data-align="right">Cantitate</th>
      <th data-part="th" data-align="right">Pret unitar</th>
      <th data-part="th" data-align="right">Valoare</th>
    </tr>`;

    let subtotal = 0;
    const bodyRows = items
      .map((item, idx) => {
        const lineTotal = Number(item.quantity) * Number(item.unit_price);
        subtotal += lineTotal;
        return `<tr data-part="tr">
        <td data-part="td" data-align="center">${idx + 1}</td>
        <td data-part="td">${escapeHtml(toString(item.description))}</td>
        <td data-part="td" data-align="center">${escapeHtml(toString(item.unit))}</td>
        <td data-part="td" data-align="right">${item.quantity}</td>
        <td data-part="td" data-align="right">${formatCurrency(Number(item.unit_price), currency)}</td>
        <td data-part="td" data-align="right">${formatCurrency(lineTotal, currency)}</td>
      </tr>`;
      })
      .join('');

    const vatAmount = subtotal * (vatRate / 100);
    const total = subtotal + vatAmount;

    const totalsRows = `
      <tr data-part="tr">
        <td data-part="td" colspan="5" data-align="right"><strong>Total fara TVA:</strong></td>
        <td data-part="td" data-align="right"><strong>${formatCurrency(subtotal, currency)}</strong></td>
      </tr>
      <tr data-part="tr">
        <td data-part="td" colspan="5" data-align="right">TVA ${vatRate}%:</td>
        <td data-part="td" data-align="right">${formatCurrency(vatAmount, currency)}</td>
      </tr>
      <tr data-part="tr">
        <td data-part="td" colspan="5" data-align="right"><div data-ui="text" data-size="lg" data-variant="strong">TOTAL:</div></td>
        <td data-part="td" data-align="right"><div data-ui="text" data-size="lg" data-variant="strong">${formatCurrency(total, currency)}</div></td>
      </tr>`;

    const header =
      series || number || date
        ? `<div data-ui="surface" data-variant="flat" style="text-align: center;">
        <div data-ui="text" data-size="xl" data-variant="strong">FACTURA</div>
        <div data-ui="text">
          ${series ? `Seria: <strong>${escapeHtml(series)}</strong>` : ''}
          ${number ? ` Nr: <strong>${escapeHtml(number)}</strong>` : ''}
        </div>
        ${date ? `<div data-ui="text">Data: <strong>${escapeHtml(date)}</strong></div>` : ''}
      </div>`
        : '';

    return `<div data-ui="stack" data-gap="3">${header}<div data-ui="table"><table><thead data-part="thead">${headerRow}</thead><tbody data-part="tbody">${bodyRows}${totalsRows}</tbody></table></div></div>`;
  },
};

import { registerComponentType } from '../core/registry.ts';
import { chartComponent } from './chart.ts';
import { headingComponent, richTextComponent, textComponent } from './content.ts';
import { kpiGridComponent, tableComponent } from './data.ts';
import { companyBlockComponent, invoiceBlockComponent } from './business.ts';

export { headingComponent, richTextComponent, textComponent } from './content.ts';
export { kpiGridComponent, tableComponent } from './data.ts';
export { companyBlockComponent, invoiceBlockComponent } from './business.ts';
export { chartComponent } from './chart.ts';
export * from './utils.ts';

const allReadOnlyComponents = [
  textComponent,
  headingComponent,
  richTextComponent,
  tableComponent,
  kpiGridComponent,
  companyBlockComponent,
  invoiceBlockComponent,
  chartComponent,
];

export function registerReadOnlyComponents(): void {
  for (const c of allReadOnlyComponents) {
    registerComponentType(c);
  }
}

export function registerAllComponents(): void {
  registerReadOnlyComponents();
}

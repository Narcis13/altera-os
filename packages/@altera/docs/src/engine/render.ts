import { evaluateCondition } from '../core/conditions.ts';
import { getComponentType } from '../core/registry.ts';
import type {
  DocumentDefinition,
  DocumentTheme,
  RenderError,
  RenderResult,
} from '../core/types.ts';
import { assembleLoomDocument, assembleLoomSection } from './loom-html.ts';
import { assembleLoomForm, type LoomFormOptions } from './loom-form.ts';
import { resolveBindings } from './resolver.ts';

export interface RenderOptions {
  formOptions?: LoomFormOptions;
}

export function renderDocument(
  definition: DocumentDefinition,
  data: Record<string, unknown> = {},
  options: RenderOptions = {},
): RenderResult {
  const theme: DocumentTheme = definition.theme ?? {};
  const errors: RenderError[] = [];
  const rendered_components: string[] = [];
  const skipped_components: string[] = [];
  const sectionHtml: string[] = [];

  for (const section of definition.sections) {
    if (section.skip_when && evaluateCondition(section.skip_when, data)) {
      for (const comp of section.components) skipped_components.push(comp.id);
      continue;
    }

    const componentHtml: string[] = [];

    for (const comp of section.components) {
      if (comp.visible_when && !evaluateCondition(comp.visible_when, data)) {
        skipped_components.push(comp.id);
        continue;
      }

      const compType = getComponentType(comp.type, comp.mode);
      if (!compType) {
        errors.push({
          component_id: comp.id,
          code: 'UNKNOWN_COMPONENT_TYPE',
          message: `Unknown component type: ${comp.type}`,
        });
        continue;
      }

      const resolvedData =
        comp.mode === 'read' && comp.bind ? resolveBindings(comp.bind, data) : data;

      if (comp.mode === 'read') {
        const validationErrors = compType.validate(resolvedData, comp);
        if (validationErrors.length > 0) {
          errors.push(...validationErrors);
          continue;
        }
      }

      componentHtml.push(compType.renderLoom(resolvedData, comp, theme));
      rendered_components.push(comp.id);
    }

    if (componentHtml.length > 0) {
      sectionHtml.push(
        assembleLoomSection(componentHtml, section.layout, section.columns),
      );
    }
  }

  const html =
    definition.kind === 'form' || definition.kind === 'hybrid'
      ? assembleLoomForm(definition, sectionHtml, theme, options.formOptions)
      : assembleLoomDocument(sectionHtml, theme, { title: definition.title });

  return { html, errors, rendered_components, skipped_components };
}

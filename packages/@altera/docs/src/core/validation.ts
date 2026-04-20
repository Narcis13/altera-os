import { evaluateCondition } from './conditions.ts';
import { getComponentType } from './registry.ts';
import type {
  DocumentComponent,
  DocumentDefinition,
  FieldError,
  ValidationResult,
} from './types.ts';

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function isFieldVisible(
  component: DocumentComponent,
  data: Record<string, unknown>,
): boolean {
  if (!component.visible_when) return true;
  return evaluateCondition(component.visible_when, data);
}

function isFieldRequired(
  component: DocumentComponent,
  data: Record<string, unknown>,
): boolean {
  if (component.required_when) return evaluateCondition(component.required_when, data);
  return component.required ?? false;
}

function validateField(
  component: DocumentComponent,
  data: Record<string, unknown>,
): FieldError[] {
  const value = data[component.id];
  if (isEmpty(value)) {
    if (isFieldRequired(component, data)) {
      return [
        {
          field_id: component.id,
          code: 'REQUIRED',
          message: `${component.label ?? component.id} is required`,
        },
      ];
    }
    return [];
  }
  const compType = getComponentType(component.type, component.mode);
  if (!compType) {
    return [
      {
        field_id: component.id,
        code: 'UNKNOWN_COMPONENT_TYPE',
        message: `Unknown component type: ${component.type}`,
      },
    ];
  }
  const errors = compType.validate(value as Record<string, unknown>, component);
  return errors.map((e) => ({
    field_id: component.id,
    code: e.code,
    message: e.message,
    ...(e.details ? { details: e.details } : {}),
  }));
}

export function validateSubmission(
  doc: DocumentDefinition,
  data: Record<string, unknown>,
): ValidationResult {
  const errors: FieldError[] = [];
  const evaluated_fields: string[] = [];
  const skipped_fields: string[] = [];

  for (const section of doc.sections) {
    if (section.skip_when && evaluateCondition(section.skip_when, data)) {
      for (const comp of section.components) skipped_fields.push(comp.id);
      continue;
    }
    for (const comp of section.components) {
      if (comp.mode !== 'input') continue;
      if (!isFieldVisible(comp, data)) {
        skipped_fields.push(comp.id);
        continue;
      }
      evaluated_fields.push(comp.id);
      errors.push(...validateField(comp, data));
    }
  }
  return { valid: errors.length === 0, errors, evaluated_fields, skipped_fields };
}

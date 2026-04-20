export type {
  ChoiceOption,
  ComparisonOp,
  ComponentTypeDefinition,
  ComponentTypeManifest,
  Condition,
  ConditionGroup,
  DocumentComponent,
  DocumentDefinition,
  DocumentSection,
  DocumentSettings,
  DocumentTheme,
  FieldCondition,
  FieldConstraints,
  FieldError,
  RenderError,
  RenderResult,
  ValidationResult,
} from './types.ts';

export {
  clearRegistry,
  getComponentType,
  getComponentTypeManifest,
  registerComponentType,
} from './registry.ts';

export { evaluateCondition } from './conditions.ts';
export { validateSubmission } from './validation.ts';
export { documentDefinitionSchema } from './schema.ts';
export type { DocumentDefinitionInput } from './schema.ts';
export {
  DocsError,
  InvalidDocumentDefinitionError,
  UnknownComponentTypeError,
} from './errors.ts';

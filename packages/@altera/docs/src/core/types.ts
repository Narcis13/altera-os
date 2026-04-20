export type ComparisonOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty';

export type Condition = FieldCondition | ConditionGroup;

export interface FieldCondition {
  field: string;
  op: ComparisonOp;
  value?: unknown;
}

export interface ConditionGroup {
  logic: 'and' | 'or';
  conditions: Condition[];
}

export interface DocumentDefinition {
  id: string;
  version: number;
  title: string;
  description?: string;
  kind: 'report' | 'form' | 'hybrid';
  theme?: DocumentTheme;
  sections: DocumentSection[];
  settings?: DocumentSettings;
  metadata?: Record<string, unknown>;
}

export interface DocumentTheme {
  fontFamily?: string;
  fontSize?: { base?: string; heading?: string; small?: string; label?: string };
  colors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    border?: string;
    background?: string;
  };
  spacing?: { section?: string; component?: string; cell?: string };
  table?: { headerBg?: string; borderColor?: string; stripedRows?: boolean };
  page?: { format?: string; orientation?: string; margin?: string };
}

export interface DocumentSection {
  id: string;
  title?: string;
  layout?: 'stack' | 'columns';
  columns?: number;
  skip_when?: Condition;
  components: DocumentComponent[];
}

export interface DocumentComponent {
  id: string;
  type: string;
  mode: 'read' | 'input';

  bind?: Record<string, string>;
  variant?: string;
  props?: Record<string, unknown>;

  label?: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  options?: ChoiceOption[];
  constraints?: FieldConstraints;
  default_value?: unknown;
  required_when?: Condition;

  visible_when?: Condition;
}

export interface ChoiceOption {
  value: string;
  label: string;
}

export interface FieldConstraints {
  min?: number;
  max?: number;
  min_length?: number;
  max_length?: number;
  pattern?: string;
  options?: string[];
}

export interface DocumentSettings {
  submit_label?: string;
  success_message?: string;
  allow_partial?: boolean;
  paginated?: boolean;
}

export interface RenderResult {
  html: string;
  errors: RenderError[];
  rendered_components: string[];
  skipped_components: string[];
}

export interface RenderError {
  component_id: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors: FieldError[];
  evaluated_fields: string[];
  skipped_fields: string[];
}

export interface FieldError {
  field_id: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ComponentTypeDefinition {
  type: string;
  label: string;
  description: string;
  agentHint?: string;
  mode: 'read' | 'input' | 'both';

  validate: (
    data: Record<string, unknown>,
    component: DocumentComponent,
  ) => RenderError[];
  coerce?: (raw: unknown) => unknown;
  defaultConstraints?: FieldConstraints;

  renderLoom: (
    data: Record<string, unknown>,
    component: DocumentComponent,
    theme: DocumentTheme,
  ) => string;
}

export interface ComponentTypeManifest {
  type: string;
  label: string;
  description: string;
  agentHint?: string;
  mode: 'read' | 'input' | 'both';
  defaultConstraints?: FieldConstraints;
}

export const EVENT_TYPES = [
  'file.uploaded',
  'entity.created',
  'entity.classified',
  'workflow.started',
  'workflow.completed',
  'report.rendered',
  'report.published',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface FileUploadedPayload {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  hashSha256: string;
}

export interface EntityCreatedPayload {
  entityId: string;
  entityType: string;
}

export interface EntityClassifiedPayload {
  entityId: string;
  classification: string;
  confidence?: number;
}

export interface WorkflowStartedPayload {
  workflowId: string;
  runId: string;
  input?: unknown;
}

export interface WorkflowCompletedPayload {
  workflowId: string;
  runId: string;
  status: 'success' | 'failure';
  output?: unknown;
  error?: string;
}

export interface ReportRenderedPayload {
  reportId: string;
  format: string;
  storagePath?: string;
}

export interface ReportPublishedPayload {
  reportId: string;
  destination: string;
  url?: string;
}

export type AlteraEvent =
  | { type: 'file.uploaded'; payload: FileUploadedPayload }
  | { type: 'entity.created'; payload: EntityCreatedPayload }
  | { type: 'entity.classified'; payload: EntityClassifiedPayload }
  | { type: 'workflow.started'; payload: WorkflowStartedPayload }
  | { type: 'workflow.completed'; payload: WorkflowCompletedPayload }
  | { type: 'report.rendered'; payload: ReportRenderedPayload }
  | { type: 'report.published'; payload: ReportPublishedPayload };

export interface EventEnvelope<E extends AlteraEvent = AlteraEvent> {
  id: string;
  tenantId: string;
  userId?: string | null;
  type: E['type'];
  payload: E extends { type: infer T; payload: infer P } ? (T extends E['type'] ? P : never) : never;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export type AnyEnvelope = EventEnvelope<AlteraEvent>;

export type EventTopic = EventType | '*';

export type EventListener = (envelope: AnyEnvelope) => void | Promise<void>;

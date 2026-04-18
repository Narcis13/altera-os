export const USER_ROLES = ['admin', 'user', 'agent'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ENTITY_STATUSES = ['raw', 'classified', 'structured', 'archived'] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export const ATTRIBUTE_SOURCES = ['agent', 'user', 'structured_import'] as const;
export type AttributeSource = (typeof ATTRIBUTE_SOURCES)[number];

export const AGENT_CHANNELS = ['web', 'telegram', 'email'] as const;
export type AgentChannel = (typeof AGENT_CHANNELS)[number];

export const WORKFLOW_STATUSES = ['running', 'completed', 'failed', 'paused'] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const DOCUMENT_KINDS = ['report', 'form', 'hybrid'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const WIKI_PAGE_TYPES = ['source', 'entity', 'concept', 'synthesis'] as const;
export type WikiPageType = (typeof WIKI_PAGE_TYPES)[number];

export const WIKI_MATURITIES = ['seed', 'developing', 'mature', 'challenged'] as const;
export type WikiMaturity = (typeof WIKI_MATURITIES)[number];

export const DEFAULT_PORT = 4000;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_JWT_ACCESS_TTL_SEC = 86_400;
export const DEFAULT_JWT_REFRESH_TTL_SEC = 604_800;
export const PASSWORD_MIN_LENGTH = 12;

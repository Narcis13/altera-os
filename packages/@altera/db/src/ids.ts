import { randomUUID } from 'node:crypto';

const PREFIXES = {
  tenant: 'tnt',
  user: 'usr',
  session: 'ses',
  audit: 'adt',
  file: 'fil',
  entity: 'ent',
  attribute: 'atr',
  event: 'evt',
  docTemplate: 'dtp',
  docSubmission: 'dsb',
  docRender: 'drn',
  workflowDef: 'wfd',
  workflowRun: 'run',
  workflowEvent: 'wfe',
} as const;

export type IdPrefix = keyof typeof PREFIXES;

export function newId(kind: IdPrefix): string {
  return `${PREFIXES[kind]}_${randomUUID().replace(/-/g, '')}`;
}

-- Altera OS — Sprint 6: docraftr + glyphrail tables

-- docraftr templates, submissions, renders
CREATE TABLE IF NOT EXISTS docs_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('report', 'form', 'hybrid')),
  definition TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS docs_templates_tenant_idx ON docs_templates(tenant_id);
CREATE INDEX IF NOT EXISTS docs_templates_tenant_kind_idx ON docs_templates(tenant_id, kind);

CREATE TABLE IF NOT EXISTS docs_submissions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES docs_templates(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  valid INTEGER NOT NULL DEFAULT 1,
  errors TEXT,
  submitted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS docs_submissions_tenant_idx ON docs_submissions(tenant_id);
CREATE INDEX IF NOT EXISTS docs_submissions_template_idx ON docs_submissions(template_id);

CREATE TABLE IF NOT EXISTS docs_renders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES docs_templates(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error')),
  errors TEXT,
  rendered_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS docs_renders_tenant_idx ON docs_renders(tenant_id);
CREATE INDEX IF NOT EXISTS docs_renders_template_idx ON docs_renders(template_id);

-- glyphrail workflow runs (replaces .glyphrail/runs/* filesystem layout)
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_name TEXT NOT NULL,
  workflow_version TEXT NOT NULL,
  workflow_source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'timed_out', 'paused', 'cancelled')),
  input TEXT NOT NULL,
  output TEXT,
  state TEXT,
  error TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  visited_steps INTEGER NOT NULL DEFAULT 0,
  elapsed_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS workflow_runs_tenant_idx ON workflow_runs(tenant_id);
CREATE INDEX IF NOT EXISTS workflow_runs_tenant_status_idx ON workflow_runs(tenant_id, status);
CREATE INDEX IF NOT EXISTS workflow_runs_tenant_name_idx ON workflow_runs(tenant_id, workflow_name);

CREATE TABLE IF NOT EXISTS workflow_run_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event TEXT NOT NULL,
  step_id TEXT,
  kind TEXT,
  status TEXT,
  duration_ms INTEGER,
  output TEXT,
  input TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS workflow_run_events_run_idx ON workflow_run_events(run_id);
CREATE INDEX IF NOT EXISTS workflow_run_events_run_seq_idx ON workflow_run_events(run_id, seq);

-- stored workflow definitions (so agents can reference by name)
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT NOT NULL,
  document TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS workflow_definitions_tenant_idx ON workflow_definitions(tenant_id);

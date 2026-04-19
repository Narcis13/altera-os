-- Altera OS — entities + attributes (Sprint 3 pre-EAV)

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  entity_type TEXT,
  name TEXT,
  status TEXT NOT NULL CHECK (status IN ('raw', 'classified', 'structured', 'archived')),
  classification_confidence REAL,
  ingested_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS entities_tenant_idx ON entities(tenant_id);
CREATE INDEX IF NOT EXISTS entities_source_file_idx ON entities(source_file_id);
CREATE INDEX IF NOT EXISTS entities_tenant_status_idx ON entities(tenant_id, status);
CREATE INDEX IF NOT EXISTS entities_tenant_ingested_idx ON entities(tenant_id, ingested_at);

CREATE TABLE IF NOT EXISTS attributes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_text TEXT,
  value_number REAL,
  value_date INTEGER,
  value_json TEXT,
  is_sensitive INTEGER NOT NULL DEFAULT 0,
  extracted_by TEXT NOT NULL CHECK (extracted_by IN ('agent', 'user', 'structured_import')),
  confidence REAL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attributes_tenant_idx ON attributes(tenant_id);
CREATE INDEX IF NOT EXISTS attributes_entity_idx ON attributes(entity_id);
CREATE INDEX IF NOT EXISTS attributes_entity_key_idx ON attributes(entity_id, key);

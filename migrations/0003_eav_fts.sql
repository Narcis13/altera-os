-- Altera OS — FTS5 index over attributes.value_text (Sprint 5)

CREATE VIRTUAL TABLE IF NOT EXISTS attributes_fts USING fts5(
  attribute_id UNINDEXED,
  entity_id UNINDEXED,
  tenant_id UNINDEXED,
  key,
  value_text,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS attributes_fts_ai AFTER INSERT ON attributes
WHEN NEW.value_text IS NOT NULL AND LENGTH(NEW.value_text) > 0
BEGIN
  INSERT INTO attributes_fts (attribute_id, entity_id, tenant_id, key, value_text)
  VALUES (NEW.id, NEW.entity_id, NEW.tenant_id, NEW.key, NEW.value_text);
END;

CREATE TRIGGER IF NOT EXISTS attributes_fts_ad AFTER DELETE ON attributes BEGIN
  DELETE FROM attributes_fts WHERE attribute_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS attributes_fts_au AFTER UPDATE ON attributes BEGIN
  DELETE FROM attributes_fts WHERE attribute_id = OLD.id;
  INSERT INTO attributes_fts (attribute_id, entity_id, tenant_id, key, value_text)
  SELECT NEW.id, NEW.entity_id, NEW.tenant_id, NEW.key, NEW.value_text
  WHERE NEW.value_text IS NOT NULL AND LENGTH(NEW.value_text) > 0;
END;

-- Backfill any existing rows
INSERT INTO attributes_fts (attribute_id, entity_id, tenant_id, key, value_text)
SELECT id, entity_id, tenant_id, key, value_text
FROM attributes
WHERE value_text IS NOT NULL AND LENGTH(value_text) > 0;

-- Taxonomy: per-tenant list of allowed entity_type values for classification.
CREATE TABLE IF NOT EXISTS entity_taxonomy (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (tenant_id, entity_type)
);
CREATE INDEX IF NOT EXISTS entity_taxonomy_tenant_idx ON entity_taxonomy(tenant_id);

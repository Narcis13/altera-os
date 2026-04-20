-- Altera OS — Sprint 7: publish flag for document renders
ALTER TABLE docs_renders ADD COLUMN published_at INTEGER;
ALTER TABLE docs_renders ADD COLUMN published_by TEXT;
CREATE INDEX IF NOT EXISTS docs_renders_published_idx ON docs_renders(tenant_id, published_at);

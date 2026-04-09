-- Retry support: add status, metadata, and dedup constraint to failed_items

ALTER TABLE failed_items
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

-- Remove duplicates (keep most recent per job+entity+source), then enforce uniqueness
DELETE FROM failed_items a
  USING failed_items b
  WHERE a.id < b.id
    AND a.job_id = b.job_id
    AND a.entity_type = b.entity_type
    AND a.source_id = b.source_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_failed_items_unique
  ON failed_items (job_id, entity_type, source_id);

CREATE INDEX IF NOT EXISTS idx_failed_items_retryable
  ON failed_items (job_id, status, retry_count);

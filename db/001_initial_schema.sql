-- Migration mappings: tracks source → destination ID for every migrated entity
CREATE TABLE IF NOT EXISTS entity_mappings (
  id            SERIAL PRIMARY KEY,
  entity_type   VARCHAR(50) NOT NULL,       -- user, organization, ticket, comment, attachment
  source_id     VARCHAR(255) NOT NULL,
  destination_id VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (entity_type, source_id)
);

CREATE INDEX idx_mappings_lookup ON entity_mappings (entity_type, source_id);

-- Migration jobs: tracks each migration run
CREATE TABLE IF NOT EXISTS migration_jobs (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  status          VARCHAR(50) NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed, cancelled
  total_items     INTEGER NOT NULL DEFAULT 0,
  processed_items INTEGER NOT NULL DEFAULT 0,
  failed_items    INTEGER NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}'
);

-- Failed items: dead-letter table for items that failed migration
CREATE TABLE IF NOT EXISTS failed_items (
  id              SERIAL PRIMARY KEY,
  job_id          INTEGER NOT NULL REFERENCES migration_jobs(id),
  entity_type     VARCHAR(50) NOT NULL,
  source_id       VARCHAR(255) NOT NULL,
  error           TEXT NOT NULL,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_failed_items_job ON failed_items (job_id);
CREATE INDEX idx_failed_items_retry ON failed_items (retry_count, last_attempt_at);

-- Audit log: records significant migration events
CREATE TABLE IF NOT EXISTS audit_log (
  id          SERIAL PRIMARY KEY,
  job_id      INTEGER REFERENCES migration_jobs(id),
  entity_type VARCHAR(50),
  source_id   VARCHAR(255),
  action      VARCHAR(100) NOT NULL,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_job ON audit_log (job_id);

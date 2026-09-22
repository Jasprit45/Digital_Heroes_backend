-- Migration 003: Charities Soft Delete

BEGIN;

ALTER TABLE charities ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Update existing queries that look for active charities
CREATE INDEX IF NOT EXISTS idx_charities_active ON charities(is_active) WHERE is_active = true;

COMMIT;

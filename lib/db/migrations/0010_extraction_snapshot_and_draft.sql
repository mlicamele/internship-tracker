-- Migration 0010: extraction snapshot + draft triage state
--
-- extraction_snapshot freezes the LLM's original output at role-creation time
-- so the user can revert any field back to "what the extractor said" later,
-- even after manual edits. Shape:
--   { values: { field: value, ... }, confidences: { field: tier, ... } }
--
-- 'draft' triage state lets a freshly-extracted role sit in the detail page's
-- Save/Discard preview without polluting the pipeline. Save flips it to
-- 'active'. Discard hard-deletes the draft.

ALTER TABLE roles ADD COLUMN extraction_snapshot JSONB NOT NULL DEFAULT '{"values":{},"confidences":{}}'::jsonb;

ALTER TYPE triage_state ADD VALUE IF NOT EXISTS 'draft' BEFORE 'inbox';

-- Revision field allows workspace-scoped template edits to use optimistic locking.
BEGIN;
ALTER TABLE workspace_settings
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
COMMIT;

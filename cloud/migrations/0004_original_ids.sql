-- Stable numeric identifiers for the original Dexie-based components.
-- The global sequence makes references unambiguous across entity kinds and
-- workspaces while keeping them inside JavaScript's safe integer range.
BEGIN;
ALTER TABLE entities ADD COLUMN local_id BIGINT GENERATED ALWAYS AS IDENTITY
  (MAXVALUE 9007199254740991);
ALTER TABLE entities ADD CONSTRAINT entities_local_id_unique UNIQUE (local_id);
CREATE INDEX entities_workspace_local_id_idx ON entities(workspace_id, local_id);
COMMIT;

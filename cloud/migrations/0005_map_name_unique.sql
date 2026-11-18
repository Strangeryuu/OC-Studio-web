-- Map names are used by the original map_id anchor field. Keep them unique per workspace.
-- A partial index allows ordinary world entries to have duplicate titles.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS entities_workspace_map_name_unique
  ON entities (workspace_id, title)
  WHERE kind='worldEntry' AND (content->>'category')='地图' AND deleted_at IS NULL;
COMMIT;

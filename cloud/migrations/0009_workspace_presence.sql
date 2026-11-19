-- Short-lived per-tab edit presence. An inactive tab disappears automatically after 45 seconds.
BEGIN;
CREATE TABLE workspace_edit_presence (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tab_id UUID NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 140),
  touched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,tab_id)
);
CREATE INDEX workspace_edit_presence_scope_idx
  ON workspace_edit_presence(workspace_id,scope,touched_at DESC);
COMMIT;

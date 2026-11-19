-- Revocable public read-only link for one workspace.
-- Keep token ciphertext only to let an owner recover/copy the active link.
-- SHA-256 digest is used for anonymous authorization lookups.
BEGIN;
CREATE TABLE IF NOT EXISTS workspace_public_shares (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  token_sha256 BYTEA NOT NULL UNIQUE,
  token_ciphertext TEXT,
  issued_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS workspace_public_shares_active_idx
  ON workspace_public_shares(token_sha256) WHERE revoked_at IS NULL;
COMMIT;

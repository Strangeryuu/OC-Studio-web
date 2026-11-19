-- Preserve historical author references while allowing administrators to deactivate
-- and anonymize an account. Better Auth login credentials and sessions are removed
-- at deletion time; owned workspaces are transferred to the acting site admin.
BEGIN;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ocstudio_user_active_email_idx
  ON "user"(email) WHERE deleted_at IS NULL;
COMMIT;

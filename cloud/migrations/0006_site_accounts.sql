-- Initial setup, invite-only registration and instance mail configuration.
BEGIN;
CREATE TABLE site_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE registration_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_sha256 BYTEA UNIQUE NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 100),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  revoked_at TIMESTAMPTZ,
  CHECK (used_count <= max_uses)
);
CREATE INDEX registration_invites_created_idx ON registration_invites(created_at DESC);
CREATE TABLE registration_redemptions (
  invite_id UUID NOT NULL REFERENCES registration_invites(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (invite_id,user_id)
);
COMMIT;

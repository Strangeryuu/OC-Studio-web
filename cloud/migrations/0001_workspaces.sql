-- OC Studio Web: workspace, collaboration, history and media schema.
-- Apply AFTER the Better Auth database tables (notably "user") are created.
-- This migration intentionally leaves authentication tables to Better Auth.
-- PostgreSQL 16+; run in a transaction through the migration runner.

BEGIN;

CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX workspaces_owner_idx ON workspaces(owner_id);

CREATE TABLE workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON workspace_members(user_id);
CREATE UNIQUE INDEX workspace_members_one_owner_idx
  ON workspace_members(workspace_id) WHERE role = 'owner';
-- Application must create owner + owner membership atomically and ensure
-- workspaces.owner_id matches the sole owner member.

CREATE TABLE workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invitee_email TEXT NOT NULL,
  invited_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  token_sha256 BYTEA NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX workspace_invitations_workspace_idx ON workspace_invitations(workspace_id);
CREATE INDEX workspace_invitations_invitee_idx ON workspace_invitations(lower(invitee_email));

CREATE TABLE entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (length(btrim(kind)) > 0),
  title TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (id, workspace_id)
);
CREATE INDEX entities_workspace_kind_idx ON entities(workspace_id, kind)
  WHERE deleted_at IS NULL;

CREATE TABLE entity_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  actor_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('create','update','restore','delete')),
  content_snapshot JSONB NOT NULL,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_id, version)
);
CREATE INDEX entity_revisions_entity_time_idx
  ON entity_revisions(entity_id, created_at DESC);

CREATE TABLE change_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  actor_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  client_mutation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (entity_id, version) REFERENCES entity_revisions(entity_id, version),
  UNIQUE (entity_id, client_mutation_id)
);
CREATE INDEX change_events_entity_time_idx ON change_events(entity_id, created_at DESC);

CREATE TABLE media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uploaded_by TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  content_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (id, workspace_id)
);
CREATE INDEX media_assets_workspace_idx ON media_assets(workspace_id);

CREATE TABLE media_references (
  media_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  revision_id UUID REFERENCES entity_revisions(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, entity_id, revision_id)
);
-- revision_id nullable means a PK is unsuitable for current references in
-- PostgreSQL; use distinct unique indexes and a surrogate identity instead.
ALTER TABLE media_references DROP CONSTRAINT media_references_pkey;
ALTER TABLE media_references ADD COLUMN id UUID PRIMARY KEY DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX media_refs_current_unique ON media_references(media_id, entity_id)
  WHERE revision_id IS NULL;
CREATE UNIQUE INDEX media_refs_history_unique ON media_references(media_id, entity_id, revision_id)
  WHERE revision_id IS NOT NULL;

CREATE TABLE workspace_settings (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  setting_key TEXT NOT NULL,
  setting_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, setting_key)
);

CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL,
  author_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (length(btrim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  FOREIGN KEY (entity_id, workspace_id) REFERENCES entities(id, workspace_id)
);
CREATE INDEX comments_entity_idx ON comments(entity_id, created_at DESC);

CREATE TABLE collab_documents (
  entity_id UUID PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  yjs_state BYTEA NOT NULL,
  seq BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE collab_updates (
  id BIGSERIAL PRIMARY KEY,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  yjs_update BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX collab_updates_entity_idx ON collab_updates(entity_id, id);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_workspace_time_idx ON audit_logs(workspace_id, created_at DESC);

COMMIT;

'use strict'

const { Pool } = require('pg')
const expectedTables = [
  'user', 'session', 'account', 'verification',
  'workspaces', 'workspace_members', 'workspace_invitations',
  'entities', 'entity_revisions', 'change_events',
  'media_assets', 'media_references', 'workspace_settings',
  'comments', 'collab_documents', 'collab_updates', 'audit_logs',
  'oc_cloud_schema_migrations', 'workspace_tags',
]
async function run() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const result = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE'`,
    )
    const actual = new Set(result.rows.map(row => row.table_name))
    const missing = expectedTables.filter(table => !actual.has(table))
    if (missing.length) throw new Error('Missing expected database tables: ' + missing.join(', '))
    const owners = await db.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename='workspace_members' AND indexname='workspace_members_one_owner_idx'`,
    )
    if (owners.rowCount !== 1) throw new Error('Workspace owner constraint index is missing')
    const authBanned = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='user' AND column_name='banned'`,
    )
    if (authBanned.rowCount !== 1) throw new Error('Better Auth admin banned field is missing')
    const migration = await db.query(
      'SELECT version FROM oc_cloud_schema_migrations WHERE version IN (1,2,3)',
    )
    if (migration.rowCount !== 3) throw new Error('Business schema migrations were not recorded')
    const settingsVersion = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='workspace_settings' AND column_name='version'",
    )
    if (settingsVersion.rowCount !== 1) throw new Error('Workspace settings version column is missing')
    const tagIndex = await db.query(
      "SELECT indexname FROM pg_indexes WHERE tablename='workspace_tags' AND indexname='workspace_tags_unique_name_idx'",
    )
    if (tagIndex.rowCount !== 1) throw new Error('Workspace tag unique-name index is missing')
    process.stdout.write('Cloud database smoke check passed (' + expectedTables.length + ' tables).\n')
  } finally {
    await db.end()
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })

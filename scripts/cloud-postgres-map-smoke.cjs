'use strict'

/**
 * Real PostgreSQL map-scope verification. Runs inside one rolled-back transaction
 * against the CI database after Better Auth + business migrations have run.
 */
const { Pool } = require('pg')
const assert = require('node:assert/strict')

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const ownerId = 'ci-map-schema-owner'
    await client.query(
      `INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt")
       VALUES($1,'CI Map Owner','map-schema-ci@example.invalid',true,now(),now())`,
      [ownerId],
    )
    const created = await client.query(
      `INSERT INTO workspaces(owner_id,name)
       VALUES($1,'CI Map Workspace A'),($1,'CI Map Workspace B') RETURNING id`,
      [ownerId],
    )
    assert.equal(created.rowCount, 2)
    const [firstWorkspace, secondWorkspace] = created.rows.map(row => row.id)
    const mapDocument = JSON.stringify({ category: '地图', title: '同名大陆' })
    const addMap = (workspaceId, title='同名大陆', content=mapDocument) => client.query(
      `INSERT INTO entities(workspace_id,kind,title,content,created_by,updated_by)
       VALUES($1,'worldEntry',$2,$3::jsonb,$4,$4) RETURNING id`,
      [workspaceId, title, content, ownerId],
    )

    const first = await addMap(firstWorkspace)
    const second = await addMap(secondWorkspace)
    assert.equal(first.rowCount, 1)
    assert.equal(second.rowCount, 1)
    assert.notEqual(first.rows[0].id, second.rows[0].id)

    // Constraint prevents concurrent same-library map names at the database level.
    await client.query('SAVEPOINT duplicate_map')
    let duplicateCode = null
    try {
      await addMap(firstWorkspace)
    } catch (error) {
      duplicateCode = error.code
    }
    assert.equal(duplicateCode, '23505', 'Same-workspace duplicate map must violate unique index')
    await client.query('ROLLBACK TO SAVEPOINT duplicate_map')
    await client.query('RELEASE SAVEPOINT duplicate_map')

    // A normal world note may share a map title; only map notes are scoped uniquely.
    const note = await addMap(firstWorkspace, '同名大陆', JSON.stringify({ category: '', title: '同名大陆' }))
    assert.equal(note.rowCount, 1)

    // A deleted map name can be reclaimed inside the owning workspace.
    await client.query('UPDATE entities SET deleted_at=now() WHERE id=$1', [first.rows[0].id])
    const recreated = await addMap(firstWorkspace)
    assert.equal(recreated.rowCount, 1)

    const rows = await client.query(
      `SELECT workspace_id, count(*)::integer AS count FROM entities
       WHERE kind='worldEntry' AND content->>'category'='地图' AND deleted_at IS NULL
       GROUP BY workspace_id ORDER BY workspace_id`,
    )
    assert.equal(rows.rows.length, 2)
    assert.ok(rows.rows.every(row => row.count === 1))
    process.stdout.write('Standalone PostgreSQL map uniqueness and workspace isolation passed.\n')
  } finally {
    try { await client.query('ROLLBACK') } finally {
      client.release()
      await pool.end()
    }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1 })

/* Cloud business migration runner (PostgreSQL, idempotent). */
'use strict'
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { Pool } = require('pg')

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()
  try {
    const sql = readFileSync(resolve(process.cwd(), 'cloud/migrations/0001_workspaces.sql'), 'utf8')
      .replace(/^\s*BEGIN;\s*/i, '')
      .replace(/\s*COMMIT;\s*$/i, '')
    await client.query('BEGIN')
    await client.query(`
      CREATE TABLE IF NOT EXISTS oc_cloud_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    const found = await client.query('SELECT 1 FROM oc_cloud_schema_migrations WHERE version=1')
    if (found.rowCount === 0) {
      await client.query(sql)
      await client.query('INSERT INTO oc_cloud_schema_migrations(version) VALUES(1)')
      process.stdout.write('Applied OC Studio cloud business migration 0001\n')
    } else {
      process.stdout.write('OC Studio cloud business migration 0001 is already applied\n')
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })

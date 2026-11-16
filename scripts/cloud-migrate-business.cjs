/* OC Studio Cloud business migrations. Run after Better Auth migration. */
'use strict'

const { readFileSync, readdirSync } = require('node:fs')
const { resolve, basename } = require('node:path')
const { Pool } = require('pg')

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const dir = resolve(process.cwd(), 'cloud/migrations')
  const files = readdirSync(dir).filter(f => /^\d{4}_[\w-]+\.sql$/.test(f)).sort()
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()
  try {
    for (const file of files) {
      const version = Number(basename(file).slice(0, 4))
      const sql = readFileSync(resolve(dir, file), 'utf8')
        .replace(/^\s*BEGIN;\s*$/gim, '')
        .replace(/^\s*COMMIT;\s*$/gim, '')
      await client.query('BEGIN')
      try {
        // Serialize concurrent app instances applying the same migrations.
        await client.query('SELECT pg_advisory_xact_lock(20261117)')
        await client.query(
          'CREATE TABLE IF NOT EXISTS oc_cloud_schema_migrations (' +
          'version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
        )
        const result = await client.query(
          'SELECT 1 FROM oc_cloud_schema_migrations WHERE version=$1', [version],
        )
        if (result.rowCount === 0) {
          await client.query(sql)
          await client.query('INSERT INTO oc_cloud_schema_migrations(version) VALUES($1)', [version])
          process.stdout.write('Applied OC Studio cloud migration ' + file + '\n')
        } else {
          process.stdout.write('Already applied OC Studio cloud migration ' + file + '\n')
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    client.release()
    await pool.end()
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })

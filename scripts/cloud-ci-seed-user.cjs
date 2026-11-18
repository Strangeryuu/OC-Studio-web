'use strict'

/**
 * CI-only fixture for the real PostgreSQL HTTP smoke test.
 * Uses Better Auth's own hashing routine and only the isolated CI database.
 * This script is never part of the production startup path.
 */
const { Pool } = require('pg')

async function run() {
  if (process.env.NODE_ENV === 'production') throw new Error('CI seed forbidden in production')
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes('ocstudio_ci')) {
    throw new Error('CI seed is restricted to the ocstudio_ci database')
  }
  const { hashPassword } = await import('better-auth/crypto')
  const password = await hashPassword('CI_only_SecurePass_456789')
  const id = 'ci-web-http-admin'
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    await pool.query('BEGIN')
    await pool.query(
      `INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",role,banned)
       VALUES($1,'CI Web Admin','ci-admin@example.test',true,now(),now(),'admin',false)`,
      [id],
    )
    await pool.query(
      `INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt")
       VALUES($1,$2,'credential',$2,$3,now(),now())`,
      ['ci-web-http-account', id, password],
    )
    await pool.query('COMMIT')
    process.stdout.write('Seeded isolated CI credential account.\n')
  } catch (error) {
    await pool.query('ROLLBACK')
    throw error
  } finally {
    await pool.end()
  }
}

run().catch(error => { console.error(error); process.exitCode = 1 })

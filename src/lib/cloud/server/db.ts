import 'server-only'
import { Pool } from 'pg'

// A single connection pool per Node process, shared by the auth service and API.
const globalPool = globalThis as typeof globalThis & { __ocStudioPgPool?: Pool }

export const pool = globalPool.__ocStudioPgPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

if (process.env.NODE_ENV !== 'production') globalPool.__ocStudioPgPool = pool

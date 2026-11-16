import { NextResponse } from 'next/server'
import { entityAccess } from '@/lib/cloud/server/entity-access'
import { pool } from '@/lib/cloud/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ entityId: string; version: string }> }) {
  const { entityId, version } = await context.params
  const access = await entityAccess(entityId, 'revision:read')
  if (access.status !== 200) return NextResponse.json({ error: access.status === 401 ? 'UNAUTHORIZED' : 'NOT_FOUND' }, { status: access.status })
  if (!/^[1-9][0-9]*$/.test(version) || !Number.isSafeInteger(Number(version))) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const result = await pool.query(
    `SELECT version,action,actor_id,created_at,content_snapshot
     FROM entity_revisions WHERE entity_id=$1 AND version=$2`,
    [entityId, Number(version)],
  )
  if (!result.rows[0]) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ revision: result.rows[0] })
}

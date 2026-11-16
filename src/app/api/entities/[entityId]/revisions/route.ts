import { NextResponse } from 'next/server'
import { entityAccess } from '@/lib/cloud/server/entity-access'
import { pool } from '@/lib/cloud/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await context.params
  const access = await entityAccess(entityId, 'revision:read')
  if (access.status !== 200) return NextResponse.json({ error: access.status === 401 ? 'UNAUTHORIZED' : 'NOT_FOUND' }, { status: access.status })
  const result = await pool.query(
    `SELECT r.version,r.action,r.summary,r.actor_id,u.name AS actor_name,r.created_at
     FROM entity_revisions r JOIN "user" u ON u.id=r.actor_id
     WHERE r.entity_id=$1 ORDER BY r.version DESC LIMIT 200`, [entityId],
  )
  return NextResponse.json({ revisions: result.rows })
}

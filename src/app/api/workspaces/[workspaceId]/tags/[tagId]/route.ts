import { NextResponse } from 'next/server'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { parseWorkspaceTag } from '@/lib/cloud/shared-tags'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, context: { params: Promise<{ workspaceId: string; tagId: string }> }) {
  if (!mutationOriginAllowed(request)) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId, tagId } = await context.params
  if (!isUuid(tagId) || !await authorizedWorkspace(user, workspaceId, 'entity:update')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const raw: unknown = await request.json().catch(() => null)
  const tag = parseWorkspaceTag(raw)
  if (!tag) return NextResponse.json({ error: 'INVALID_TAG' }, { status: 400 })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const prior = await client.query<{ name: string; color: string }>(
      'SELECT name,color FROM workspace_tags WHERE id=$1 AND workspace_id=$2 FOR UPDATE',
      [tagId, workspaceId],
    )
    if (!prior.rows[0]) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    }
    const result = await client.query<{ id: string; name: string; color: string }>(
      `UPDATE workspace_tags SET name=$3,color=$4,updated_at=now()
       WHERE id=$1 AND workspace_id=$2 RETURNING id,name,color`,
      [tagId, workspaceId, tag.name, tag.color],
    )
    await client.query(
      `INSERT INTO audit_logs(workspace_id,actor_id,action,target_id,details)
       VALUES($1,$2,'tag:update',$3,$4::jsonb)`,
      [workspaceId, user.id, tagId, JSON.stringify({ previous: prior.rows[0], next: tag })],
    )
    await client.query('COMMIT')
    return NextResponse.json({ tag: result.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return NextResponse.json({ error: 'TAG_EXISTS' }, { status: 409 })
    }
    throw error
  } finally { client.release() }
}

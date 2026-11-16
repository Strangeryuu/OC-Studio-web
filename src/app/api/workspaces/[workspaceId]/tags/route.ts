import { NextResponse } from 'next/server'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { parseWorkspaceTag } from '@/lib/cloud/shared-tags'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ workspaceId: string }> }

export async function GET(_request: Request, context: Context) {
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId } = await context.params
  if (!await authorizedWorkspace(user, workspaceId, 'entity:read')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const tags = await pool.query<{ id: string; name: string; color: string }>(
    'SELECT id,name,color FROM workspace_tags WHERE workspace_id=$1 ORDER BY lower(name) LIMIT 500',
    [workspaceId],
  )
  return NextResponse.json({ tags: tags.rows }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(request: Request, context: Context) {
  if (!mutationOriginAllowed(request)) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId } = await context.params
  if (!await authorizedWorkspace(user, workspaceId, 'entity:create')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const raw: unknown = await request.json().catch(() => null)
  const tag = parseWorkspaceTag(raw)
  if (!tag) return NextResponse.json({ error: 'INVALID_TAG' }, { status: 400 })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{ id: string; name: string; color: string }>(
      `INSERT INTO workspace_tags(workspace_id,name,color,created_by)
       VALUES($1,$2,$3,$4) RETURNING id,name,color`,
      [workspaceId, tag.name, tag.color, user.id],
    )
    await client.query(
      `INSERT INTO audit_logs(workspace_id,actor_id,action,target_id,details)
       VALUES($1,$2,'tag:create',$3,$4::jsonb)`,
      [workspaceId, user.id, result.rows[0].id, JSON.stringify(tag)],
    )
    await client.query('COMMIT')
    return NextResponse.json({ tag: result.rows[0] }, { status: 201 })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return NextResponse.json({ error: 'TAG_EXISTS' }, { status: 409 })
    }
    throw error
  } finally { client.release() }
}

import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { isEntityKind, readEntityDocument } from '@/lib/cloud/entity-input'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId } = await context.params
  if (!await authorizedWorkspace(user, workspaceId, 'entity:read')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const result = await pool.query(
    `SELECT id,kind,title,version,updated_at FROM entities
      WHERE workspace_id=$1 AND deleted_at IS NULL
      ORDER BY updated_at DESC LIMIT 200`, [workspaceId],
  )
  return NextResponse.json({ entities: result.rows })
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  if (!mutationOriginAllowed(request)) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId } = await context.params
  if (!await authorizedWorkspace(user, workspaceId, 'entity:create')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const raw: unknown = await request.json().catch(() => null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json({ error: 'INVALID_ENTITY' }, { status: 400 })
  }
  const body = raw as Record<string, unknown>
  const doc = readEntityDocument(body)
  if (!isEntityKind(body.kind) || !doc) {
    return NextResponse.json({ error: 'INVALID_ENTITY' }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{ id: string; version: number }>(
      `INSERT INTO entities(workspace_id,kind,title,content,created_by,updated_by)
       VALUES($1,$2,$3,$4::jsonb,$5,$5) RETURNING id,version`,
      [workspaceId, body.kind, doc.title, JSON.stringify(doc.data), user.id],
    )
    const entity = result.rows[0]
    await client.query(
      `INSERT INTO entity_revisions(entity_id,version,actor_id,action,content_snapshot)
       VALUES($1,$2,$3,'create',$4::jsonb)`,
      [entity.id, entity.version, user.id, JSON.stringify(doc)],
    )
    await client.query(
      `INSERT INTO change_events(entity_id,version,actor_id,action)
       VALUES($1,$2,$3,'create')`,
      [entity.id, entity.version, user.id],
    )
    await client.query('COMMIT')
    return NextResponse.json({ entity: { ...entity, workspaceId, kind: body.kind, ...doc } }, { status: 201 })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

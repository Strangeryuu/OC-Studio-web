import { NextResponse } from 'next/server'
import { currentCloudUser } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const result = await pool.query(
    `SELECT w.id,w.name,w.description,w.updated_at,m.role
     FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
     WHERE m.user_id=$1 AND w.deleted_at IS NULL
     ORDER BY w.updated_at DESC LIMIT 100`,
    [user.id],
  )
  return NextResponse.json({ workspaces: result.rows })
}

export async function POST(request: Request) {
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const body: unknown = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }
  const { name, description } = body as Record<string, unknown>
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100 ||
    (description !== undefined && (typeof description !== 'string' || description.length > 2000))) {
    return NextResponse.json({ error: 'INVALID_WORKSPACE' }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{ id: string; name: string; description: string | null }>(
      'INSERT INTO workspaces(owner_id,name,description) VALUES ($1,$2,$3) RETURNING id,name,description',
      [user.id, name.trim(), description ?? null],
    )
    const workspace = result.rows[0]
    await client.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'owner')", [workspace.id, user.id])
    await client.query("INSERT INTO audit_logs(workspace_id,actor_id,action) VALUES ($1,$2,'workspace:create')", [workspace.id, user.id])
    await client.query('COMMIT')
    return NextResponse.json({ workspace: { ...workspace, role: 'owner' } }, { status: 201 })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

import { NextResponse } from 'next/server'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { isInviteRole } from '@/lib/cloud/invitation-policy'
import { pool } from '@/lib/cloud/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ workspaceId: string; userId: string }> }

async function getManager(request: Request, context: Context) {
  if (!mutationOriginAllowed(request)) return { error: NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 }) }
  const user = await currentCloudUser()
  if (!user) return { error: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) }
  const { workspaceId, userId } = await context.params
  if (!userId || userId.length > 256 || !await authorizedWorkspace(user, workspaceId, 'member:manage')) {
    return { error: NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 }) }
  }
  return { user, workspaceId, userId }
}

export async function PATCH(request: Request, context: Context) {
  const manager = await getManager(request, context)
  if (manager.error) return manager.error
  const { user, workspaceId, userId } = manager
  if (!user || !workspaceId || !userId) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  const raw: unknown = await request.json().catch(() => null)
  const role = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).role : null
  if (!isInviteRole(role)) return NextResponse.json({ error: 'INVALID_ROLE' }, { status: 400 })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query<{ role: string }>(
      'SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE',
      [workspaceId, userId],
    )
    const oldRole = found.rows[0]?.role
    if (!oldRole) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 }) }
    if (oldRole === 'owner') { await client.query('ROLLBACK'); return NextResponse.json({ error: 'OWNER_PROTECTED' }, { status: 403 }) }
    await client.query(
      'UPDATE workspace_members SET role=$3 WHERE workspace_id=$1 AND user_id=$2',
      [workspaceId, userId, role],
    )
    await client.query(
      `INSERT INTO audit_logs(workspace_id,actor_id,action,target_id,details)
       VALUES($1,$2,'member:role-change',$3,$4::jsonb)`,
      [workspaceId, user.id, userId, JSON.stringify({ from: oldRole, to: role })],
    )
    await client.query('COMMIT')
    return NextResponse.json({ userId, role })
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}

export async function DELETE(request: Request, context: Context) {
  const manager = await getManager(request, context)
  if (manager.error) return manager.error
  const { user, workspaceId, userId } = manager
  if (!user || !workspaceId || !userId) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query<{ role: string }>(
      'SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE',
      [workspaceId, userId],
    )
    const oldRole = found.rows[0]?.role
    if (!oldRole) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 }) }
    if (oldRole === 'owner') { await client.query('ROLLBACK'); return NextResponse.json({ error: 'OWNER_PROTECTED' }, { status: 403 }) }
    await client.query('DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2', [workspaceId, userId])
    await client.query(
      `INSERT INTO audit_logs(workspace_id,actor_id,action,target_id,details)
       VALUES($1,$2,'member:remove',$3,$4::jsonb)`,
      [workspaceId, user.id, userId, JSON.stringify({ formerRole: oldRole })],
    )
    await client.query('COMMIT')
    return NextResponse.json({ removed: userId })
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}

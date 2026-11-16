import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId } = await context.params
  if (!await authorizedWorkspace(user, workspaceId, 'workspace:read')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const result = await pool.query(
    `SELECT m.user_id,u.name,u.email,m.role,m.joined_at
     FROM workspace_members m JOIN "user" u ON u.id=m.user_id
     WHERE m.workspace_id=$1 ORDER BY m.joined_at ASC`,
    [workspaceId],
  )
  return NextResponse.json({ members: result.rows })
}

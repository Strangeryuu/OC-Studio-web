import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId } = await context.params
  const role = await authorizedWorkspace(user, workspaceId, 'workspace:read')
  if (!role) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  const result = await pool.query(
    'SELECT id,name,description,created_at,updated_at FROM workspaces WHERE id=$1 AND deleted_at IS NULL',
    [workspaceId],
  )
  if (!result.rows[0]) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ workspace: { ...result.rows[0], role } })
}

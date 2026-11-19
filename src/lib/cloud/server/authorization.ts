import 'server-only'
import { headers } from 'next/headers'
import { auth } from './auth'
import { pool } from './db'
import { canPerformWorkspaceAction, type WorkspaceAction, type WorkspaceRole } from '@/lib/cloud/permissions'
import { isSiteAdmin } from '@/lib/cloud/site-policy'

export interface CloudUser { id: string; email: string; name: string; role: string | null }

// Read session and current account status from DB at every sensitive API request.
export async function currentCloudUser(): Promise<CloudUser | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session || session.user.banned) return null
  const result = await pool.query<CloudUser>(
    'SELECT id, email, name,role FROM "user" WHERE id=$1 AND COALESCE(banned,false)=false',
    [session.user.id],
  )
  return result.rows[0] ?? null
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function authorizedWorkspace(
  user: CloudUser, workspaceId: string, action: WorkspaceAction,
): Promise<WorkspaceRole | null> {
  if (!isUuid(workspaceId)) return null
  if (isSiteAdmin(user.role)) {
    const workspace=await pool.query('SELECT id FROM workspaces WHERE id=$1 AND deleted_at IS NULL',[workspaceId])
    return workspace.rowCount ? 'owner' : null
  }
  const result = await pool.query<{ role: WorkspaceRole }>(
    `SELECT m.role FROM workspace_members m
     JOIN workspaces w ON w.id=m.workspace_id
     WHERE m.workspace_id=$1 AND m.user_id=$2 AND w.deleted_at IS NULL`,
    [workspaceId, user.id],
  )
  const role = result.rows[0]?.role ?? null
  return canPerformWorkspaceAction({ accountStatus: 'active', role }, action) ? role : null
}

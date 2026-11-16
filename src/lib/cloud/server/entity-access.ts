import 'server-only'
import { currentCloudUser, authorizedWorkspace, isUuid } from './authorization'
import { pool } from './db'
import type { WorkspaceAction } from '@/lib/cloud/permissions'

/** Fail closed and hide the existence of entities from other workspaces. */
export async function entityAccess(entityId: string, action: WorkspaceAction, expectedWorkspaceId?: string | null) {
  const user = await currentCloudUser()
  if (!user) return { status: 401 as const, user: null, workspaceId: null }
  if (!isUuid(entityId)) return { status: 404 as const, user, workspaceId: null }
  const found = await pool.query<{ workspace_id: string }>(
    'SELECT workspace_id FROM entities WHERE id=$1', [entityId],
  )
  const workspaceId = found.rows[0]?.workspace_id
  if (!workspaceId || (expectedWorkspaceId != null && expectedWorkspaceId !== workspaceId) ||
    !await authorizedWorkspace(user, workspaceId, action)) {
    return { status: 404 as const, user, workspaceId: null }
  }
  return { status: 200 as const, user, workspaceId }
}

import { redirect } from 'next/navigation'
import { currentCloudUser } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { WorkspaceDashboard, type WorkspaceListItem } from '@/components/cloud/WorkspaceDashboard'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const user = await currentCloudUser()
  if (!user) redirect('/login')
  const result = await pool.query<WorkspaceListItem>(
    `SELECT w.id,w.name,w.description,w.updated_at::text,m.role
     FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
     WHERE m.user_id=$1 AND w.deleted_at IS NULL
     ORDER BY w.updated_at DESC LIMIT 100`, [user.id],
  )
  return <WorkspaceDashboard initialWorkspaces={result.rows} userName={user.name} />
}

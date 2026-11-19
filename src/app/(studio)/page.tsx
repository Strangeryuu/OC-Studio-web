import { redirect } from 'next/navigation'
import { currentCloudUser } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { WorkspaceDashboard, type WorkspaceListItem } from '@/components/cloud/WorkspaceDashboard'
import { isSiteAdmin } from '@/lib/cloud/site-policy'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const user = await currentCloudUser()
  if (!user) redirect('/login')
  const result = await pool.query<WorkspaceListItem>(
    `SELECT w.id,w.name,w.description,w.updated_at::text,COALESCE(m.role,CASE WHEN $2::boolean THEN 'owner' ELSE 'viewer' END) AS role
     FROM workspaces w LEFT JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=$1
     WHERE (m.user_id IS NOT NULL OR $2::boolean) AND w.deleted_at IS NULL
     ORDER BY w.updated_at DESC LIMIT 100`, [user.id,isSiteAdmin(user.role)],
  )
  return <WorkspaceDashboard initialWorkspaces={result.rows} userName={user.name} />
}

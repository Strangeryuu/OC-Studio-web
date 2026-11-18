import { redirect } from 'next/navigation'
import { currentCloudUser } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'

export const dynamic = 'force-dynamic'

export default async function StudioEntry() {
  const user = await currentCloudUser()
  if (!user) redirect('/login')
  const result = await pool.query<{ id: string }>(
    `SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
     WHERE m.user_id=$1 AND w.deleted_at IS NULL LIMIT 2`,
    [user.id],
  )
  if (result.rows.length === 1) redirect(`/studio/${result.rows[0].id}`)
  redirect('/')
}

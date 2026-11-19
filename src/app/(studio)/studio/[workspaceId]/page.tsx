import { notFound, redirect } from 'next/navigation'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { InviteCreateForm } from '@/components/cloud/InviteCreateForm'
import { WorkspaceMembers, type MemberRow } from '@/components/cloud/WorkspaceMembers'
import { WorkspacePublicShare } from '@/components/cloud/WorkspacePublicShare'
import { isSiteAdmin } from '@/lib/cloud/site-policy'
import { WorkspaceCharacters } from '@/features/characters/cloud/WorkspaceCharacters'

export const dynamic = 'force-dynamic'

export default async function WorkspacePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await currentCloudUser()
  if (!user) redirect('/login')
  const { workspaceId } = await params
  const role = await authorizedWorkspace(user, workspaceId, 'workspace:read')
  if (!role) notFound()
  const result = await pool.query<{ name: string; description: string | null; owner_id: string }>(
    'SELECT name,description,owner_id FROM workspaces WHERE id=$1 AND deleted_at IS NULL', [workspaceId],
  )
  const workspace = result.rows[0]
  if (!workspace) notFound()
  const members = await pool.query<MemberRow>(
    `SELECT m.user_id,u.name,u.email,m.role FROM workspace_members m
     JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY m.joined_at ASC`, [workspaceId],
  )
  return <WorkspaceCharacters workspaceId={workspaceId} role={role} workspaceName={workspace.name}
    workspaceDescription={workspace.description}
    membersPanel={<>
      {(workspace.owner_id === user.id || isSiteAdmin(user.role)) &&
        <WorkspacePublicShare workspaceId={workspaceId} />}
      <WorkspaceMembers workspaceId={workspaceId} selfId={user.id} role={role} initialMembers={members.rows} />
      {(role === 'owner' || role === 'admin') && <section className="rounded-panel border border-line p-5">
        <h2 className="mb-4 text-reading font-medium">邀请成员</h2>
        <InviteCreateForm workspaceId={workspaceId} />
      </section>}
    </>} />
}

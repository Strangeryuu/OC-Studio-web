import { notFound, redirect } from 'next/navigation'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { InviteCreateForm } from '@/components/cloud/InviteCreateForm'
import { WorkspaceMembers, type MemberRow } from '@/components/cloud/WorkspaceMembers'

export const dynamic = 'force-dynamic'

export default async function WorkspacePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await currentCloudUser()
  if (!user) redirect('/login')
  const { workspaceId } = await params
  const role = await authorizedWorkspace(user, workspaceId, 'workspace:read')
  if (!role) notFound()
  const result = await pool.query<{ name: string; description: string | null }>(
    'SELECT name,description FROM workspaces WHERE id=$1 AND deleted_at IS NULL', [workspaceId],
  )
  const workspace = result.rows[0]
  if (!workspace) notFound()
  const members = await pool.query<MemberRow>(
    `SELECT m.user_id,u.name,u.email,m.role FROM workspace_members m
     JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY m.joined_at ASC`, [workspaceId],
  )
  return <div className="flex flex-col gap-7">
    <a href="/" className="text-ui text-ink-muted">返回我的世界观</a>
    <div>
      <h1 className="text-lg font-semibold">{workspace.name}</h1>
      <p className="mt-2 text-ui text-ink-muted">{workspace.description || '私人世界观'} · {role}</p>
      <p className="mt-3 text-ui text-ink-muted">原版编辑器的云端数据适配正在进行，暂未开放编辑。</p>
    </div>
    <WorkspaceMembers workspaceId={workspaceId} selfId={user.id} role={role} initialMembers={members.rows} />
    {(role === 'owner' || role === 'admin') && <section className="rounded-panel border border-line p-5">
      <h2 className="mb-4 text-reading font-medium">邀请成员</h2>
      <InviteCreateForm workspaceId={workspaceId} />
    </section>}
  </div>
}

import { notFound, redirect } from 'next/navigation'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { InviteCreateForm } from '@/components/cloud/InviteCreateForm'

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
  const memberResult = await pool.query<{ user_id: string; name: string; role: string }>(
    `SELECT m.user_id,u.name,m.role FROM workspace_members m
     JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY m.joined_at ASC`, [workspaceId],
  )
  return <div className="flex flex-col gap-7">
    <a href="/" className="text-sm opacity-70">返回我的世界观</a>
    <div><h1 className="text-2xl font-semibold">{workspace.name}</h1>
      <p className="mt-2 text-sm opacity-70">{workspace.description || '私人世界观'}</p>
      <p className="mt-2 text-xs opacity-60">你在此项目中的权限：{role}</p></div>
    <section className="rounded-lg border border-[var(--oc-line)] p-5">
      <h2 className="mb-4 text-lg font-medium">项目成员</h2>
      <ul className="flex flex-col gap-2">{memberResult.rows.map(m =>
        <li key={m.user_id} className="flex justify-between border-b border-[var(--oc-line)] py-2 text-sm">
          <span>{m.name}</span><span className="opacity-70">{m.role}</span>
        </li>)}</ul>
    </section>
    {(role === 'owner' || role === 'admin') && <section className="rounded-lg border border-[var(--oc-line)] p-5">
      <h2 className="mb-4 text-lg font-medium">邀请成员</h2>
      <InviteCreateForm workspaceId={workspaceId} />
    </section>}
    <p className="text-sm opacity-70">角色、世界观正文、立绘及历史记录的云端迁移仍在开发。本页暂用于安全地管理项目与邀请。</p>
  </div>
}

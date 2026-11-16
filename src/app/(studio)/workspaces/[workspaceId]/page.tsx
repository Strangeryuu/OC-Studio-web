import { notFound, redirect } from 'next/navigation'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { InviteCreateForm } from '@/components/cloud/InviteCreateForm'
import { WorkspaceCharacters } from '@/components/cloud/WorkspaceCharacters'
import type { CloudEntityListItem } from '@/lib/cloud/client-types'
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
  const memberResult = await pool.query<MemberRow>(
    `SELECT m.user_id,u.name,u.email,m.role FROM workspace_members m
     JOIN "user" u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY m.joined_at ASC`, [workspaceId],
  )
  const entityResult = await pool.query<CloudEntityListItem>(
    `SELECT id,kind,title,version,updated_at FROM entities
     WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200`,
    [workspaceId],
  )
  return <div className="flex flex-col gap-7">
    <a href="/" className="text-sm opacity-70">返回我的世界观</a>
    <div><h1 className="text-2xl font-semibold">{workspace.name}</h1>
      <p className="mt-2 text-sm opacity-70">{workspace.description || '私人世界观'}</p>
      <p className="mt-2 text-xs opacity-60">你在此项目中的权限：{role}</p>
      <a href={'/workspaces/' + workspaceId + '/settings/character'}
        className="mt-3 inline-block rounded border border-[var(--oc-line)] px-3 py-2 text-sm">
        角色模板与字段设置
      </a>
    </div>
    <WorkspaceCharacters workspaceId={workspaceId} role={role} initialEntities={entityResult.rows} />
    <WorkspaceMembers workspaceId={workspaceId} selfId={user.id} role={role} initialMembers={memberResult.rows} />
    {(role === 'owner' || role === 'admin') && <section className="rounded-lg border border-[var(--oc-line)] p-5">
      <h2 className="mb-4 text-lg font-medium">邀请成员</h2>
      <InviteCreateForm workspaceId={workspaceId} />
    </section>}
  </div>
}

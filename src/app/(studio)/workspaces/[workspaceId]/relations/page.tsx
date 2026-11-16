import { notFound, redirect } from 'next/navigation'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { parseCloudRelations, type CloudRelationCandidate } from '@/lib/cloud/character-links'
import { CloudRelationGraph } from '@/components/cloud/CloudRelationGraph'

export const dynamic = 'force-dynamic'

export default async function WorkspaceRelationsPage({ params }: {
  params: Promise<{ workspaceId: string }>
}) {
  const user = await currentCloudUser()
  if (!user) redirect('/login')
  const { workspaceId } = await params
  if (!await authorizedWorkspace(user, workspaceId, 'entity:read')) notFound()
  const result = await pool.query<CloudRelationCandidate & { content: Record<string, unknown> }>(
    `SELECT id,title,content FROM entities WHERE workspace_id=$1
     AND kind='character' AND deleted_at IS NULL ORDER BY title LIMIT 300`,
    [workspaceId],
  )
  const characters = result.rows.map(({ id, title }) => ({ id, title }))
  const shown = new Set(characters.map(c => c.id))
  const links = result.rows.flatMap(character => (parseCloudRelations(character.content.cloudRelations) ?? [])
    .filter(link => shown.has(link.targetId))
    .map(link => ({
      source: character.id, target: link.targetId,
      relation: link.relation, arrow: link.arrow,
    })))
  return <div className="flex flex-col gap-5">
    <a href={'/workspaces/' + workspaceId} className="text-sm opacity-70">返回世界观</a>
    <div><h1 className="text-2xl font-semibold">人物关系图</h1>
      <p className="mt-2 text-sm opacity-70">
        显示当前世界观内最多 300 个角色的云端命名关系。可进入角色编辑页添加、修改或移除关系。
      </p></div>
    <CloudRelationGraph workspaceId={workspaceId} characters={characters} links={links} />
    {links.length === 0 && <p className="text-sm opacity-70">当前尚无已保存的云端角色关系。</p>}
  </div>
}

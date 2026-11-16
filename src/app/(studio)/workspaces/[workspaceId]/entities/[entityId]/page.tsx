import { notFound, redirect } from 'next/navigation'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { CloudCharacterEditor } from '@/components/cloud/CloudCharacterEditor'
import { loadCloudCharacterConfig } from '@/lib/cloud/server/character-config'
import type { CloudEntityRow } from '@/lib/cloud/client-types'
import type { CloudRelationCandidate, CloudInboundRelation } from '@/lib/cloud/character-links'
import type { CloudWorkspaceTag } from '@/lib/cloud/shared-tags'

export const dynamic = 'force-dynamic'

export default async function CloudCharacterPage({ params }: {
  params: Promise<{ workspaceId: string; entityId: string }>
}) {
  const user = await currentCloudUser()
  if (!user) redirect('/login')
  const { workspaceId, entityId } = await params
  if (!isUuid(workspaceId) || !isUuid(entityId)) notFound()
  const role = await authorizedWorkspace(user, workspaceId, 'entity:read')
  if (!role) notFound()
  const result = await pool.query<CloudEntityRow>(
    `SELECT id,workspace_id,kind,title,content,version,updated_at
     FROM entities WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL AND kind='character'`,
    [entityId, workspaceId],
  )
  const entity = result.rows[0]
  if (!entity) notFound()
  const { config } = await loadCloudCharacterConfig(workspaceId)
  const [characters, inboundResult, tagResult] = await Promise.all([
    pool.query<CloudRelationCandidate>(
      `SELECT id,title FROM entities WHERE workspace_id=$1 AND kind='character' AND deleted_at IS NULL
       ORDER BY title LIMIT 300`, [workspaceId],
    ),
    pool.query<CloudInboundRelation>(
      `SELECT e.id AS "sourceId", e.title AS "sourceTitle", rel.entry->>'relation' AS relation
       FROM entities e
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(e.content->'cloudRelations')='array'
         THEN e.content->'cloudRelations' ELSE '[]'::jsonb END
       ) AS rel(entry)
       WHERE e.workspace_id=$1 AND e.kind='character'
         AND e.deleted_at IS NULL AND e.id<>$2
         AND rel.entry->>'targetId'=$2::text
       ORDER BY e.title LIMIT 100`,
      [workspaceId, entityId],
    ),
    pool.query<CloudWorkspaceTag>(
      'SELECT id,name,color FROM workspace_tags WHERE workspace_id=$1 ORDER BY lower(name) LIMIT 500',
      [workspaceId],
    ),
  ])
  return <CloudCharacterEditor workspaceId={workspaceId} role={role} initial={entity}
    config={config} candidates={characters.rows} inbound={inboundResult.rows} sharedTags={tagResult.rows} />
}

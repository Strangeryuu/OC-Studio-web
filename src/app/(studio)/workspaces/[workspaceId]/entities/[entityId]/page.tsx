import { notFound, redirect } from 'next/navigation'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { CloudCharacterEditor } from '@/components/cloud/CloudCharacterEditor'
import type { CloudEntityRow } from '@/lib/cloud/client-types'

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
  return <CloudCharacterEditor workspaceId={workspaceId} role={role} initial={entity} />
}

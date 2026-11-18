import 'server-only'
import type { PoolClient } from 'pg'
import { characterMediaIds } from '@/lib/cloud/character-media'

/** An entity may only reference media owned by its workspace.
 * Always use this inside the same transaction as the entity write.
 */
export async function characterMediaAllowed(
  client: PoolClient, workspaceId: string, kind: string, content: unknown,
): Promise<boolean> {
  const ids = characterMediaIds(kind, content)
  if (ids === null) return false
  if (ids.length === 0) return true
  const result = await client.query<{ id: string }>(
    `SELECT id FROM media_assets
     WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL`,
    [workspaceId, ids],
  )
  return result.rows.length === ids.length
}

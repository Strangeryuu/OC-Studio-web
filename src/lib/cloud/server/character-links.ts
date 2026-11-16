import 'server-only'
import type { PoolClient } from 'pg'
import { characterLinkIds } from '@/lib/cloud/character-links'

/** Verify every cloud reference belongs to the same workspace, in the
 * same transaction as the entity insert/update. Deleted character references
 * are retained to allow editing and history restoration of old characters.
 */
export async function characterLinksAllowed(
  client: PoolClient, workspaceId: string, kind: string, content: unknown, selfId?: string,
): Promise<boolean> {
  const links = characterLinkIds(kind, content, selfId)
  if (!links) return false
  if (links.targets.length) {
    const result = await client.query(
      `SELECT id FROM entities WHERE workspace_id=$1 AND kind='character' AND id=ANY($2::uuid[])`,
      [workspaceId, links.targets],
    )
    if (result.rows.length !== links.targets.length) return false
  }
  if (links.tags.length) {
    const result = await client.query(
      'SELECT id FROM workspace_tags WHERE workspace_id=$1 AND id=ANY($2::uuid[])',
      [workspaceId, links.tags],
    )
    if (result.rows.length !== links.tags.length) return false
  }
  return true
}

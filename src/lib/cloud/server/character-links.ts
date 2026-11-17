import 'server-only'
import type { PoolClient } from 'pg'
import { characterLinkIds } from '@/lib/cloud/character-links'

/** Verify every cloud reference belongs to the same workspace, in the
 * same transaction as the entity insert/update. Deleted character references
 * are retained to allow editing and history restoration of old characters.
 */
export async function characterLinksAllowed(
  client: PoolClient, workspaceId: string, kind: string, content: unknown, selfId?: string, previousContent?: unknown,
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
  if (kind === 'character') {
    const numericLinks = (value: unknown): number[] | null => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const relations = (value as Record<string, unknown>).relatedCharacters
      if (relations === undefined) return []
      if (!Array.isArray(relations) || relations.length > 1000) return null
      const ids: number[] = []
      for (const relation of relations) {
        if (!relation || typeof relation !== 'object' || Array.isArray(relation)) return null
        const id = (relation as Record<string, unknown>).characterId
        if (id === undefined || id === null) continue
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null
        ids.push(id)
      }
      return [...new Set(ids)]
    }
    const current = numericLinks(content)
    const previous = numericLinks(previousContent)
    if (!current || !previous) return false
    // Preserve historical dangling references, while validating all newly added IDs.
    const added = current.filter(id => !previous.includes(id))
    if (added.length) {
      const result = await client.query(
        `SELECT local_id FROM entities WHERE workspace_id=$1 AND kind='character'
         AND local_id=ANY($2::bigint[]) AND ($3::uuid IS NULL OR id<>$3::uuid)`,
        [workspaceId, added, selfId ?? null],
      )
      if (result.rows.length !== added.length) return false
    }
  }
  return true
}

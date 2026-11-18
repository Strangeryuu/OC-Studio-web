import type { PoolClient } from 'pg'
import { NOVEL_CATEGORY } from '@/lib/entry-kinds'
import { cloudMediaUrlId } from '@/lib/cloud/character-media'

/**
 * Novel roots/chapters are original notes; the parent must be a novel in the
 * same workspace. The ordinary world-link guard checks reference cycles.
 */
export async function cloudNovelAllowed(
  client: PoolClient, workspaceId: string, kind: string, content: unknown,
  previousContent?: unknown,
): Promise<boolean> {
  if (kind !== 'worldEntry') return true
  if (!content || typeof content !== 'object' || Array.isArray(content)) return false
  const next = content as Record<string, unknown>
  const prev = previousContent && typeof previousContent === 'object' && !Array.isArray(previousContent)
    ? previousContent as Record<string, unknown> : null
  if (prev?.category === NOVEL_CATEGORY && next.category !== NOVEL_CATEGORY) return false
  if (next.category !== NOVEL_CATEGORY) return true
  if (typeof next.title !== 'string' || !next.title.trim() || next.title.length > 200) return false
  const order = next.order
  if (order != null && (typeof order !== 'number' || !Number.isSafeInteger(order) || order < 0)) return false
  for (const key of ['novelAuthor','novelSynopsis','novelNotes','chapterOutline']) {
    const item = next[key]
    if (item != null && (typeof item !== 'string' || item.length > 20000)) return false
  }
  if (next.novelTargetWords != null && (typeof next.novelTargetWords !== 'number' ||
    !Number.isSafeInteger(next.novelTargetWords) || next.novelTargetWords < 0 || next.novelTargetWords > 100000000)) return false
  if (next.novelCover != null && (typeof next.novelCover !== 'string' ||
    (next.novelCover !== '' && cloudMediaUrlId(next.novelCover) === null))) return false
  const parent = next.parentId
  if (parent == null) return true
  if (typeof parent !== 'number' || !Number.isSafeInteger(parent) || parent <= 0) return false
  const result = await client.query(
    `SELECT 1 FROM entities WHERE workspace_id=$1 AND kind='worldEntry'
       AND local_id=$2 AND content->>'category'=$3 AND deleted_at IS NULL LIMIT 1`,
    [workspaceId, parent, NOVEL_CATEGORY],
  )
  return result.rowCount === 1
}

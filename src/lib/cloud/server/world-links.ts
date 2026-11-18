import 'server-only'
import type { PoolClient } from 'pg'
import { collectRefs, refKey, type DocNode } from '@/lib/reference-labels'
import { worldBodyOf } from '@/lib/world-body'
import { parseOriginalId } from '@/lib/cloud/original-ids'
import { entityRecord, numericIds, scopedTargetsAllowed } from './original-links'

function noteIds(value: unknown): number[] | null {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 1000) return null
  const targets: unknown[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const id = entityRecord(item).targetId
    if (id != null) targets.push(id)
  }
  return numericIds(targets)
}

function bodyTargets(record: Record<string, unknown>) {
  const body = worldBodyOf({
    document: record.document, content: typeof record.content === 'string' ? record.content : undefined,
  })
  return typeof body === 'object' ? collectRefs(body as DocNode) : []
}

const BODY_TYPES = { world: 'worldEntry', character: 'character', country: 'country', event: 'event' } as const

export async function worldLinksAllowed(
  client: PoolClient, workspaceId: string, kind: string, content: unknown, selfId?: string, previousContent?: unknown,
): Promise<boolean> {
  if (kind !== 'worldEntry' && kind !== 'character') return true
  const current = entityRecord(content)
  const previous = entityRecord(previousContent)
  const key = kind === 'character' ? 'relatedNotes' : 'relations'
  const targets = noteIds(current[key])
  if (targets === null || !await scopedTargetsAllowed(client, workspaceId, 'worldEntry', targets, noteIds(previous[key]), selfId)) {
    return false
  }
  if (kind === 'character') return true

  const before = new Set(bodyTargets(previous).map(ref => refKey(ref.entityType, ref.id)))
  const after = bodyTargets(current).filter(ref => !before.has(refKey(ref.entityType, ref.id)))
  for (const [type, targetKind] of Object.entries(BODY_TYPES)) {
    const next = after.filter(ref => ref.entityType === type).map(ref => parseOriginalId(ref.id))
    if (next.some(id => id === null) || !await scopedTargetsAllowed(
      client, workspaceId, targetKind, next.filter(id => id !== null), [],
    )) return false
  }

  if (current.parentId == null || current.parentId === previous.parentId) return true
  const parent = current.parentId
  if (typeof parent !== 'number' || !Number.isSafeInteger(parent) || parent <= 0) return false

  // Serialize changes to parent edges before reading the ancestor chain.
  await client.query('SELECT id FROM workspaces WHERE id=$1 FOR NO KEY UPDATE', [workspaceId])
  if (!await scopedTargetsAllowed(client, workspaceId, 'worldEntry', [parent], [], selfId)) return false
  if (!selfId) return true
  const ancestor = await client.query(
    `WITH RECURSIVE ancestors AS (
       SELECT id, content FROM entities WHERE workspace_id=$1 AND kind='worldEntry' AND local_id=$2
       UNION
       SELECT parent.id, parent.content FROM entities parent JOIN ancestors a ON parent.local_id::text=(a.content->>'parentId')
       WHERE parent.workspace_id=$1 AND parent.kind='worldEntry'
     ) SELECT id FROM ancestors WHERE id=$3`,
    [workspaceId, parent, selfId],
  )
  return ancestor.rows.length === 0
}

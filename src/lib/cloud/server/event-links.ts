import 'server-only'
import type { PoolClient } from 'pg'

function eventRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function numericIds(values: unknown): number[] | null {
  if (values === undefined || values === null) return []
  if (!Array.isArray(values) || values.length > 1000) return null
  const result = new Set<number>()
  for (const id of values) {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null
    result.add(id)
  }
  return Array.from(result)
}

function relatedEvents(values: unknown): number[] | null {
  if (values === undefined || values === null) return []
  if (!Array.isArray(values) || values.length > 1000) return null
  const ids = values.map(value => eventRecord(value).targetId)
  return numericIds(ids)
}

/** Bind newly added original event links to active targets inside the entity write transaction. */
export async function eventLinksAllowed(
  client: PoolClient, workspaceId: string, content: unknown, selfId?: string, previousContent?: unknown,
): Promise<boolean> {
  const current = eventRecord(content)
  const previous = eventRecord(previousContent)
  const targets = [
    { kind: 'character', next: numericIds(current.characters), before: numericIds(previous.characters) },
    { kind: 'country', next: numericIds(current.countries), before: numericIds(previous.countries) },
    { kind: 'event', next: relatedEvents(current.relations), before: relatedEvents(previous.relations) },
    { kind: 'event', next: numericIds(current.parentEventId == null ? [] : [current.parentEventId]),
      before: numericIds(previous.parentEventId == null ? [] : [previous.parentEventId]) },
  ]
  for (const { kind, next, before } of targets) {
    if (next === null) return false
    // An unchanged historical reference may point to a deleted target.
    const existing = new Set(before ?? [])
    const added = next.filter(id => !existing.has(id))
    if (added.length === 0) continue
    const result = await client.query(
      `SELECT local_id FROM entities WHERE workspace_id=$1 AND kind=$2
       AND local_id=ANY($3::bigint[]) AND deleted_at IS NULL AND ($4::uuid IS NULL OR id<>$4::uuid)`,
      [workspaceId, kind, added, selfId ?? null],
    )
    if (result.rows.length !== added.length) return false
  }
  return true
}

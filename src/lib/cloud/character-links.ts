/**
 * Cloud-only UUID references. The original numeric relation and tag fields
 * remain untouched for future .ocbak migration.
 */
export const CLOUD_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type CloudRelationArrow = 'none' | 'forward' | 'backward' | 'both'
export interface CloudCharacterRelation {
  id: string
  targetId: string
  relation: string
  arrow: CloudRelationArrow
}
export interface CloudRelationCandidate { id: string; title: string }
export interface CloudInboundRelation { sourceId: string; sourceTitle: string; relation: string }

const arrows = new Set<CloudRelationArrow>(['none', 'forward', 'backward', 'both'])

export function parseCloudRelations(value: unknown): CloudCharacterRelation[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 100) return null
  const results: CloudCharacterRelation[] = []
  const seenIds = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    if (!CLOUD_UUID_RE.test(String(record.id)) || !CLOUD_UUID_RE.test(String(record.targetId)) ||
      typeof record.relation !== 'string' || !record.relation.trim() || record.relation.trim().length > 60 ||
      !arrows.has(record.arrow as CloudRelationArrow) || seenIds.has(String(record.id))) return null
    seenIds.add(record.id as string)
    results.push({
      id: record.id as string, targetId: record.targetId as string,
      relation: record.relation.trim(), arrow: record.arrow as CloudRelationArrow,
    })
  }
  return results
}

export function parseCloudTagIds(value: unknown): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 30 ||
    value.some(id => typeof id !== 'string' || !CLOUD_UUID_RE.test(id)) ||
    new Set(value).size !== value.length) return null
  return value
}

export function cloudRelationsForDisplay(value: unknown): CloudCharacterRelation[] {
  return parseCloudRelations(value) ?? []
}

export function cloudTagIdsForDisplay(value: unknown): string[] {
  return parseCloudTagIds(value) ?? []
}

/** Invalid UUID references fail closed before database access. */
export function characterLinkIds(kind: unknown, content: unknown, selfId?: string): {
  targets: string[]
  tags: string[]
} | null {
  if (kind !== 'character') return { targets: [], tags: [] }
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null
  const record = content as Record<string, unknown>
  const relations = parseCloudRelations(record.cloudRelations)
  const tags = parseCloudTagIds(record.cloudTagIds)
  if (!relations || !tags || (selfId && relations.some(r => r.targetId === selfId))) return null
  return {
    targets: [...new Set(relations.map(r => r.targetId))],
    tags,
  }
}

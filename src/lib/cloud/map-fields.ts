import type { PoolClient } from 'pg'
import { MAP_CATEGORY } from '@/lib/entry-kinds'
import { cloudMediaUrlId } from '@/lib/cloud/character-media'
import { minPoints, type AnnotationKind } from '@/features/map/annotations'
import type { MapAnchor } from '@/features/map/types'

/** Validate map data before it enters a versioned cloud entity. */
export function normalizeMapAnchor(value: unknown): MapAnchor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { x, y } = value as Record<string, unknown>
  if (typeof x !== 'number' || typeof y !== 'number' ||
    !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x, y }
}

function validAnnotations(raw: string): boolean {
  if (raw.length > 250_000) return false
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return false }
  if (!Array.isArray(parsed) || parsed.length > 400) return false
  return parsed.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const entry = item as Record<string, unknown>
    const kind: AnnotationKind | null = entry.kind === 'border' || entry.kind === 'road' ? entry.kind : null
    return kind !== null && typeof entry.id === 'string' && entry.id.length > 0 && entry.id.length < 100 &&
      Array.isArray(entry.points) && entry.points.length >= minPoints(kind) && entry.points.length <= 1000 &&
      entry.points.every(point => normalizeMapAnchor(point) !== null)
  })
}

export function validMapFields(kind: string, content: unknown): boolean {
  if (kind !== 'country' && kind !== 'event' && kind !== 'worldEntry') return true
  if (!content || typeof content !== 'object' || Array.isArray(content)) return false
  const record = content as Record<string, unknown>
  const position = record.mapPosition
  const mapId = record.mapId
  if (position != null && normalizeMapAnchor(position) === null) return false
  if (mapId != null && (typeof mapId !== 'string' || mapId.length > 200)) return false
  if (mapId && position == null) return false

  if (kind !== 'worldEntry') return true
  const ownMapFields = ['mapImage', 'mapWidth', 'mapHeight', 'mapSeed', 'mapParams', 'mapMode', 'mapAnnotations']
  const isMap = record.category === MAP_CATEGORY
  if (!isMap) return ownMapFields.every(key => record[key] == null)
  const image = record.mapImage
  if (image != null && image !== '' && (typeof image !== 'string' || cloudMediaUrlId(image) === null)) return false
  for (const key of ['mapWidth', 'mapHeight']) {
    const value = record[key]
    if (value != null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 50000)) return false
  }
  if (image && (record.mapWidth == null || record.mapHeight == null)) return false
  if (record.mapSeed != null && (typeof record.mapSeed !== 'number' || !Number.isFinite(record.mapSeed))) return false
  if (record.mapParams != null && (typeof record.mapParams !== 'string' || record.mapParams.length > 200_000)) return false
  if (record.mapMode != null && (typeof record.mapMode !== 'string' || record.mapMode.length > 40)) return false
  if (record.mapAnnotations != null && (typeof record.mapAnnotations !== 'string' ||
    (record.mapAnnotations !== '' && !validAnnotations(record.mapAnnotations)))) return false
  return true
}

/** Pins may reference only map entries in the same workspace. */
export async function cloudMapAllowed(
  client: PoolClient, workspaceId: string, kind: string, content: unknown, title: string, selfId?: string,
): Promise<boolean> {
  if (!validMapFields(kind, content)) return false
  if (kind !== 'country' && kind !== 'event' && kind !== 'worldEntry') return true
  const record = content as Record<string, unknown>
  if (kind === 'worldEntry' && record.category === MAP_CATEGORY) {
    if (record.title !== title) return false
    const duplicate = await client.query(
      `SELECT 1 FROM entities
       WHERE workspace_id=$1 AND kind='worldEntry' AND content->>'category'=$2
         AND title=$3 AND deleted_at IS NULL AND ($4::uuid IS NULL OR id<>$4::uuid)
       LIMIT 1`,
      [workspaceId, MAP_CATEGORY, title, selfId ?? null],
    )
    if (duplicate.rowCount) return false
  }
  const mapName = record.mapId
  if (typeof mapName !== 'string' || mapName === '') return true
  const found = await client.query(
    `SELECT 1 FROM entities WHERE workspace_id=$1 AND kind='worldEntry'
       AND title=$2 AND content->>'category'=$3 AND deleted_at IS NULL LIMIT 1`,
    [workspaceId, mapName, MAP_CATEGORY],
  )
  return found.rowCount === 1
}

import type { RelationNodeType } from '@/features/relations/types'

/** All-or-nothing graph relayout request, shared by the cloud UI and API. */
export const GRAPH_LAYOUT_LIMIT = 1000
export const GRAPH_LAYOUT_KIND: Record<RelationNodeType, string> = {
  character: 'character',
  country: 'country',
  event: 'event',
  world: 'worldEntry',
}
export interface GraphLayoutItem {
  id: string
  entityType: RelationNodeType
  localId: number
  expectedVersion: number
  x: number
  y: number
}
export interface GraphLayoutResult {
  positions: Array<{ id: string; version: number; x: number; y: number }>
}
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function readGraphLayoutRequest(body: unknown): GraphLayoutItem[] | null {
  if (!isRecord(body) || !Array.isArray(body.positions) ||
      body.positions.length < 1 || body.positions.length > GRAPH_LAYOUT_LIMIT) return null
  const seen = new Set<string>()
  const rows: GraphLayoutItem[] = []
  for (const item of body.positions) {
    if (!isRecord(item) || typeof item.id !== 'string' || !UUID_RE.test(item.id) ||
        !Object.hasOwn(GRAPH_LAYOUT_KIND, String(item.entityType)) ||
        !Number.isSafeInteger(item.localId) || Number(item.localId) <= 0 ||
        !Number.isSafeInteger(item.expectedVersion) || Number(item.expectedVersion) < 1 ||
        typeof item.x !== 'number' || !Number.isFinite(item.x) || Math.abs(item.x) > 1_000_000 ||
        typeof item.y !== 'number' || !Number.isFinite(item.y) || Math.abs(item.y) > 1_000_000 ||
        seen.has(item.id.toLowerCase())) return null
    seen.add(item.id.toLowerCase())
    rows.push({
      id: item.id,
      entityType: item.entityType as RelationNodeType,
      localId: item.localId as number,
      expectedVersion: item.expectedVersion as number,
      x: Math.round(item.x * 10) / 10,
      y: Math.round(item.y * 10) / 10,
    })
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id))
}

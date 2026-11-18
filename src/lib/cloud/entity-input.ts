import type { JsonValue } from './versioning'

export interface EntityDocument {
  title: string
  data: JsonValue
}

const ENTITY_KINDS = new Set([
  'character', 'event', 'country', 'worldEntry', 'novelChapter', 'period', 'tag',
])

export function readEntityDocument(value: unknown): EntityDocument | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  if (typeof obj.title !== 'string' || obj.title.trim().length < 1 || obj.title.trim().length > 200) {
    return null
  }
  if (obj.data === undefined || obj.data === null || typeof obj.data !== 'object' || Array.isArray(obj.data)) {
    return null
  }
  const position = (obj.data as Record<string, unknown>).graphPosition
  if (position != null) {
    if (typeof position !== 'object' || Array.isArray(position)) return null
    const { x, y } = position as Record<string, unknown>
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null
  }
  try {
    const text = JSON.stringify(obj.data)
    if (text.length > 1_000_000) return null
    const data: JsonValue = JSON.parse(text) as JsonValue
    return { title: obj.title.trim(), data }
  } catch {
    return null
  }
}

export function isEntityKind(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_KINDS.has(value)
}

export function readExpectedVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

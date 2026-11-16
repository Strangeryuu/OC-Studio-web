/**
 * Immutable, deterministic revision planning for server-side optimistic locking.
 *
 * This module only PREPARES a mutation. The caller MUST perform the SQL UPDATE
 * (WHERE id = ? AND workspace_id = ? AND version = expectedVersion) and INSERT
 * into entity_revisions + change_events within the SAME database transaction.
 * Derive actorId from the authenticated session and workspaceId from an
 * authorized resource lookup, not client-provided actor claims.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface VersionedEntity {
  id: string
  workspaceId: string
  version: number
  content: JsonValue
}

export interface RevisionSnapshot {
  entityId: string
  version: number
  actorId: string
  contentSnapshot: JsonValue
  action: 'update'
  createdAt: string
}

export type MutationPlan =
  | { kind: 'conflict'; expectedVersion: number; actualVersion: number }
  | { kind: 'unchanged'; current: VersionedEntity }
  | { kind: 'ready'; next: VersionedEntity; revision: RevisionSnapshot }

function normalizedJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(normalizedJson)
  if (value !== null && typeof value === 'object') {
    const sorted: { [key: string]: JsonValue } = {}
    for (const key of Object.keys(value).sort()) {
      Object.defineProperty(sorted, key, {
        value: normalizedJson(value[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return sorted
  }
  return value
}

function cloneJson(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

export function planEntityUpdate(input: {
  current: VersionedEntity
  expectedVersion: number
  nextContent: JsonValue
  actorId: string
  createdAt: string
}): MutationPlan {
  const { current, expectedVersion, nextContent, actorId, createdAt } = input
  if (!Number.isSafeInteger(current.version) || current.version < 1) {
    throw new Error('Invalid persisted entity version')
  }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('Invalid expected version')
  }
  if (!actorId.trim()) throw new Error('Authenticated actor is required')
  if (!current.id || !current.workspaceId) throw new Error('Entity identity is required')

  if (expectedVersion !== current.version) {
    return { kind: 'conflict', expectedVersion, actualVersion: current.version }
  }
  if (JSON.stringify(normalizedJson(current.content)) === JSON.stringify(normalizedJson(nextContent))) {
    return { kind: 'unchanged', current }
  }

  const version = current.version + 1
  if (!Number.isSafeInteger(version)) throw new Error('Entity revision overflow')
  const savedContent = cloneJson(nextContent)
  return {
    kind: 'ready',
    next: { ...current, version, content: savedContent },
    revision: {
      entityId: current.id,
      version,
      actorId,
      contentSnapshot: cloneJson(savedContent),
      action: 'update',
      createdAt,
    },
  }
}

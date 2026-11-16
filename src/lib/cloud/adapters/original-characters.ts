import type { Character } from '@/types'
import type { CharacterFormData } from '@/features/characters/types'
import { CLOUD_UUID_RE } from '@/lib/cloud/character-links'
import { parseOriginalId } from '@/lib/cloud/original-ids'

/** A snapshot ties the original component's numeric ID to a server revision. */
export interface OriginalCharacterSnapshot {
  readonly workspaceId: string
  readonly entityId: string
  readonly version: number
  readonly character: Character
}

export class CloudCharacterError extends Error {
  constructor(readonly code: string, readonly status: number, readonly actualVersion?: number) {
    super(code === 'VERSION_CONFLICT' ? '此角色已在其他位置修改，请先处理版本冲突' : `云端操作失败：${code}`)
    this.name = 'CloudCharacterError'
  }
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>
type RecordValue = Record<string, unknown>

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function makeSnapshot(workspaceId: string, entityId: unknown, localId: unknown, version: unknown, data: unknown): OriginalCharacterSnapshot {
  const id = parseOriginalId(String(localId))
  if (typeof entityId !== 'string' || !CLOUD_UUID_RE.test(entityId) || id === null ||
    typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 || !record(data) ||
    typeof data.name !== 'string' || typeof data.deleted !== 'boolean' ||
    typeof data.createdAt !== 'number' || typeof data.updatedAt !== 'number' ||
    !Array.isArray(data.aliases) || !Array.isArray(data.relatedCharacters) ||
    !Array.isArray(data.gallery) || !Array.isArray(data.avatars) || !Array.isArray(data.tags)) {
    throw new CloudCharacterError('INVALID_CHARACTER_DATA', 500)
  }
  // Server identity always overrides any id embedded in the stored document.
  return { workspaceId, entityId, version, character: { ...structuredClone(data), id } as unknown as Character }
}

async function responseJson(response: Response): Promise<RecordValue> {
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = record(data) && typeof data.error === 'string' ? data.error : 'REQUEST_FAILED'
    const actual = record(data) && typeof data.actualVersion === 'number' ? data.actualVersion : undefined
    throw new CloudCharacterError(error, response.status, actual)
  }
  if (!record(data)) throw new CloudCharacterError('INVALID_RESPONSE', 500)
  return data
}

/** One instance belongs to one authenticated workspace; no cross-workspace cache. */
export class OriginalCharactersCloudAdapter {
  private readonly base: string
  constructor(readonly workspaceId: string, private readonly fetcher: Fetcher = fetch) {
    if (!CLOUD_UUID_RE.test(workspaceId)) throw new Error('Invalid workspace ID')
    this.base = `/api/workspaces/${workspaceId}`
  }

  async list(): Promise<OriginalCharacterSnapshot[]> {
    const result: OriginalCharacterSnapshot[] = []
    const cursors = new Set<string>()
    let cursor: string | null = null
    do {
      const response = await this.fetcher(`${this.base}/legacy-entities${cursor ? `?after=${cursor}` : ''}`, {
        cache: 'no-store',
      })
      const json = await responseJson(response)
      if (!Array.isArray(json.entities)) throw new CloudCharacterError('INVALID_RESPONSE', 500)
      for (const item of json.entities) {
        if (!record(item)) throw new CloudCharacterError('INVALID_RESPONSE', 500)
        if (item.kind === 'character' && item.deleted_at === null) {
          result.push(makeSnapshot(this.workspaceId, item.id, item.local_id, item.version, item.content))
        }
      }
      const next: unknown = json.nextCursor
      if (next !== null && (typeof next !== 'string' || parseOriginalId(next) === null || cursors.has(next))) {
        throw new CloudCharacterError('INVALID_CURSOR', 500)
      }
      cursor = next as string | null
      if (cursor) cursors.add(cursor)
    } while (cursor !== null)
    return result
  }

  async create(character: Omit<Character, 'id'>): Promise<OriginalCharacterSnapshot> {
    const data = structuredClone(character)
    const response = await this.fetcher(`${this.base}/entities`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'character', title: data.name, data }),
    })
    const body = await responseJson(response)
    if (!record(body.entity) || body.entity.workspaceId !== this.workspaceId || body.entity.kind !== 'character') {
      throw new CloudCharacterError('INVALID_RESPONSE', 500)
    }
    return makeSnapshot(this.workspaceId, body.entity.id, body.entity.local_id, body.entity.version, body.entity.data)
  }

  async save(snapshot: OriginalCharacterSnapshot, patch: Partial<CharacterFormData>): Promise<OriginalCharacterSnapshot> {
    if (snapshot.workspaceId !== this.workspaceId) throw new CloudCharacterError('WORKSPACE_MISMATCH', 400)
    const { id: localId, ...original } = structuredClone(snapshot.character)
    const filtered = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
    const data = { ...original, ...structuredClone(filtered), updatedAt: Date.now() }
    const response = await this.fetcher(`/api/entities/${snapshot.entityId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-OC-Workspace-Id': this.workspaceId },
      body: JSON.stringify({ expectedVersion: snapshot.version, title: data.name, data }),
    })
    const body = await responseJson(response)
    return makeSnapshot(this.workspaceId, snapshot.entityId, localId, body.version, data)
  }

  async remove(snapshot: OriginalCharacterSnapshot): Promise<void> {
    if (snapshot.workspaceId !== this.workspaceId) throw new CloudCharacterError('WORKSPACE_MISMATCH', 400)
    const response = await this.fetcher(`/api/entities/${snapshot.entityId}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-OC-Workspace-Id': this.workspaceId },
      body: JSON.stringify({ expectedVersion: snapshot.version }),
    })
    await responseJson(response)
  }
}

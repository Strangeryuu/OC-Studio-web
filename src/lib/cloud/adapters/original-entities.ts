import { CLOUD_UUID_RE } from '@/lib/cloud/character-links'
import { parseOriginalId } from '@/lib/cloud/original-ids'

export interface OriginalSnapshot<T> {
  readonly workspaceId: string
  readonly entityId: string
  readonly version: number
  readonly entity: T
}

export class CloudEntityError extends Error {
  constructor(readonly code: string, readonly status: number, readonly actualVersion?: number) {
    super(code === 'VERSION_CONFLICT' ? '此条目已在其他位置修改，请先处理版本冲突' : `云端操作失败：${code}`)
    this.name = 'CloudEntityError'
  }
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>
export type RecordValue = Record<string, unknown>

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function responseJson(response: Response): Promise<RecordValue> {
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = record(data) && typeof data.error === 'string' ? data.error : 'REQUEST_FAILED'
    const actual = record(data) && typeof data.actualVersion === 'number' ? data.actualVersion : undefined
    throw new CloudEntityError(error, response.status, actual)
  }
  if (!record(data)) throw new CloudEntityError('INVALID_RESPONSE', 500)
  return data
}

/** One instance belongs to one authenticated workspace; no cross-workspace cache. */
export class OriginalEntityCloudAdapter<T extends { id: number; name: string }, Patch extends object> {
  private readonly base: string
  constructor(
    readonly workspaceId: string,
    private readonly kind: string,
    private readonly readEntity: (id: number, data: RecordValue, title: unknown) => T,
    private readonly fetcher: Fetcher,
  ) {
    if (!CLOUD_UUID_RE.test(workspaceId)) throw new Error('Invalid workspace ID')
    this.base = `/api/workspaces/${workspaceId}`
  }

  private snapshot(entityId: unknown, localId: unknown, version: unknown, data: unknown, title: unknown): OriginalSnapshot<T> {
    const id = parseOriginalId(String(localId))
    if (typeof entityId !== 'string' || !CLOUD_UUID_RE.test(entityId) || id === null ||
      typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 || !record(data)) {
      throw new CloudEntityError('INVALID_ENTITY_DATA', 500)
    }
    return { workspaceId: this.workspaceId, entityId, version, entity: this.readEntity(id, structuredClone(data), title) }
  }

  async list(): Promise<OriginalSnapshot<T>[]> {
    const result: OriginalSnapshot<T>[] = []
    const cursors = new Set<string>()
    let cursor: string | null = null
    do {
      const response = await this.fetcher(`${this.base}/legacy-entities?kind=${this.kind}${cursor ? `&after=${cursor}` : ''}`, {
        cache: 'no-store',
      })
      const json = await responseJson(response)
      if (!Array.isArray(json.entities)) throw new CloudEntityError('INVALID_RESPONSE', 500)
      for (const item of json.entities) {
        if (!record(item)) throw new CloudEntityError('INVALID_RESPONSE', 500)
        if (item.kind === this.kind && item.deleted_at === null) {
          result.push(this.snapshot(item.id, item.local_id, item.version, item.content, item.title))
        }
      }
      const next: unknown = json.nextCursor
      if (next !== null && (typeof next !== 'string' || parseOriginalId(next) === null || cursors.has(next))) {
        throw new CloudEntityError('INVALID_CURSOR', 500)
      }
      cursor = next as string | null
      if (cursor) cursors.add(cursor)
    } while (cursor !== null)
    return result
  }

  async create(entity: Omit<T, 'id'>): Promise<OriginalSnapshot<T>> {
    const data = structuredClone(entity)
    const response = await this.fetcher(`${this.base}/entities`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: this.kind, title: data.name, data }),
    })
    const body = await responseJson(response)
    if (!record(body.entity) || body.entity.workspaceId !== this.workspaceId || body.entity.kind !== this.kind) {
      throw new CloudEntityError('INVALID_RESPONSE', 500)
    }
    return this.snapshot(body.entity.id, body.entity.local_id, body.entity.version, body.entity.data, data.name)
  }

  async save(snapshot: OriginalSnapshot<T>, patch: Patch): Promise<OriginalSnapshot<T>> {
    if (snapshot.workspaceId !== this.workspaceId) throw new CloudEntityError('WORKSPACE_MISMATCH', 400)
    const { id: localId, ...original } = structuredClone(snapshot.entity)
    const filtered = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
    const data = { ...original, ...structuredClone(filtered), updatedAt: Date.now() }
    const response = await this.fetcher(`/api/entities/${snapshot.entityId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-OC-Workspace-Id': this.workspaceId },
      body: JSON.stringify({ expectedVersion: snapshot.version, title: data.name, data }),
    })
    const body = await responseJson(response)
    return this.snapshot(snapshot.entityId, localId, body.version, data, data.name)
  }

  async remove(snapshot: OriginalSnapshot<T>): Promise<void> {
    if (snapshot.workspaceId !== this.workspaceId) throw new CloudEntityError('WORKSPACE_MISMATCH', 400)
    const response = await this.fetcher(`/api/entities/${snapshot.entityId}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-OC-Workspace-Id': this.workspaceId },
      body: JSON.stringify({ expectedVersion: snapshot.version }),
    })
    await responseJson(response)
  }
}

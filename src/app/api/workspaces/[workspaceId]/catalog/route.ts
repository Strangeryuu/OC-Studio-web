import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { pool } from '@/lib/cloud/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ workspaceId: string }> }
type Stored = { id: string; kind: string; version: number; content: Record<string, unknown> }
const headers = { 'Cache-Control': 'private, no-store' }
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers })
const validName = (name: unknown): name is string =>
  typeof name === 'string' && name.length <= 60 && name.trim().length > 0 && name.trim() === name
const validVersion = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const entry = (value: unknown): value is { id: string; expectedVersion: number } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return isUuid(row.id) && validVersion(row.expectedVersion) && row.expectedVersion > 0
}

export async function GET(_request: Request, context: Context) {
  const user = await currentCloudUser()
  if (!user) return fail('UNAUTHORIZED', 401)
  const { workspaceId } = await context.params
  if (!isUuid(workspaceId) || !await authorizedWorkspace(user, workspaceId, 'workspace:read')) return fail('NOT_FOUND', 404)
  const result = await pool.query<{ setting_value: unknown; version: number }>(
    "SELECT setting_value,version FROM workspace_settings WHERE workspace_id=$1 AND setting_key='character-folders'",
    [workspaceId],
  )
  const saved = result.rows[0]
  const folders = saved?.setting_value
  if (folders !== undefined && (!Array.isArray(folders) || !folders.every(validName))) return fail('INVALID_SAVED_FOLDERS', 500)
  return NextResponse.json({ folders: folders ?? [], version: saved?.version ?? 0 }, { headers })
}

/**
 * Two atomic catalog operations. Reordering writes all ranks in one transaction,
 * while folder changes write the workspace registry and affected characters together.
 * Lock order mirrors entity PATCH: workspace first, then entity rows ordered by id.
 */
export async function POST(request: Request, context: Context) {
  if (!mutationOriginAllowed(request)) return fail('INVALID_ORIGIN', 403)
  const user = await currentCloudUser()
  if (!user) return fail('UNAUTHORIZED', 401)
  const { workspaceId } = await context.params
  if (!isUuid(workspaceId) || !await authorizedWorkspace(user, workspaceId, 'entity:update')) return fail('NOT_FOUND', 404)
  const raw = await request.text()
  if (raw.length > 240_000) return fail('CATALOG_TOO_LARGE', 413)
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return fail('INVALID_CATALOG', 400) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('INVALID_CATALOG', 400)
  const body = parsed as Record<string, unknown>
  const isReorder = body.action === 'reorder'
  const isFolders = body.action === 'folders'
  if (!isReorder && !isFolders) return fail('INVALID_ACTION', 400)
  const kind = isReorder ? body.kind : 'character'
  if (kind !== 'character' && kind !== 'country' && kind !== 'event') return fail('INVALID_KIND', 400)
  const rows = isReorder ? body.entries : body.updates
  if (!Array.isArray(rows) || rows.length > 1500 || !rows.every(entry)) return fail('INVALID_ENTRIES', 400)
  const ids = rows.map(row => row.id.toLowerCase())
  if (new Set(ids).size !== ids.length) return fail('DUPLICATE_ENTRY', 400)
  if (isReorder && (
    rows.length === 0 || !rows.every((row, index) => row.order === index)
  )) return fail('INVALID_ORDER', 400)
  const folderNames = isFolders ? body.folders : []
  if (isFolders) {
    if (!validVersion(body.expectedFolderVersion) || !Array.isArray(folderNames) || folderNames.length > 200 ||
      !folderNames.every(validName) || new Set(folderNames).size !== folderNames.length ||
      !rows.every(row => (row.folder === null || validName(row.folder)) &&
        (row.folder === null || folderNames.includes(row.folder)))) {
      return fail('INVALID_FOLDERS', 400)
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const workspace = await client.query('SELECT id FROM workspaces WHERE id=$1 AND deleted_at IS NULL FOR NO KEY UPDATE', [workspaceId])
    if (workspace.rowCount !== 1) { await client.query('ROLLBACK'); return fail('NOT_FOUND', 404) }
    const found = await client.query<Stored>(
      'SELECT id,kind,version,content FROM entities WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE',
      [workspaceId, ids],
    )
    if (found.rows.length !== rows.length) { await client.query('ROLLBACK'); return fail('ENTRY_MISSING', 404) }
    const byId = new Map(found.rows.map(row => [row.id.toLowerCase(), row]))
    for (const item of rows) {
      const current = byId.get(item.id.toLowerCase())
      if (!current || current.kind !== kind) { await client.query('ROLLBACK'); return fail('ENTRY_KIND_MISMATCH', 400) }
      if (current.version !== item.expectedVersion) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'VERSION_CONFLICT', entityId: item.id, actualVersion: current.version },
          { status: 409, headers })
      }
    }
    if (isReorder) {
      // Require the full live collection; stale clients cannot silently drop entries from a reordering.
      const count = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM entities WHERE workspace_id=$1 AND kind=$2 AND deleted_at IS NULL',
        [workspaceId, kind],
      )
      if (Number(count.rows[0]?.count) !== rows.length) {
        await client.query('ROLLBACK')
        return fail('CATALOG_CHANGED', 409)
      }
    } else {
      const setting = await client.query<{ version: number }>(
        "SELECT version FROM workspace_settings WHERE workspace_id=$1 AND setting_key='character-folders' FOR UPDATE",
        [workspaceId],
      )
      if ((setting.rows[0]?.version ?? 0) !== body.expectedFolderVersion) {
        await client.query('ROLLBACK')
        return fail('FOLDER_VERSION_CONFLICT', 409)
      }
    }
    const versionMap: Record<string, number> = {}
    for (const [index, item] of rows.entries()) {
      const current = byId.get(item.id.toLowerCase())!
      const desired = isReorder ? index : item.folder
      const previous = isReorder ? current.content.order : current.content.folder ?? null
      if (previous === desired) { versionMap[current.id] = current.version; continue }
      const next = { ...current.content, [isReorder ? 'order' : 'folder']: desired }
      const version = current.version + 1
      await client.query(
        'UPDATE entities SET content=$1::jsonb,version=$2,updated_by=$3,updated_at=now() WHERE id=$4 AND workspace_id=$5',
        [JSON.stringify(next), version, user.id, current.id, workspaceId],
      )
      versionMap[current.id] = version
    }
    let folderVersion: number | undefined
    if (isFolders) {
      const result = await client.query<{ version: number }>(
        "INSERT INTO workspace_settings(workspace_id,setting_key,setting_value,version) VALUES($1,'character-folders',$2::jsonb,1) " +
        "ON CONFLICT(workspace_id,setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,version=workspace_settings.version+1,updated_at=now() RETURNING version",
        [workspaceId, JSON.stringify(folderNames)],
      )
      folderVersion = result.rows[0].version
    }
    await client.query('COMMIT')
    return NextResponse.json({ versions: versionMap, ...(isFolders ? { folders: folderNames, folderVersion } : {}) }, { headers })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

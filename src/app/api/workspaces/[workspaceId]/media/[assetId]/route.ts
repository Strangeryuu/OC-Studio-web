import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { pool } from '@/lib/cloud/server/db'
import { rewriteMediaReferences } from '@/lib/cloud/media-rewrite'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ workspaceId: string; assetId: string }> }
type EntityRow = { id: string; title: string; version: number; kind: string; content: Record<string, unknown> }
type CoverRow = { version: number; setting_value: unknown }
type Preview = {
  affected: Array<{ id: string; title: string; kind: string; version: number; references: number }>
  coverVersion: number | null
  references: number
}
const MAX_AFFECTED = 2000

function analyze(rows: EntityRow[], cover: CoverRow | undefined, source: string): Preview {
  const affected = rows.flatMap(row => {
    const refs = rewriteMediaReferences(row.content, source, null).references
    return refs ? [{ id: row.id, title: row.title, kind: row.kind,
      version: row.version, references: refs }] : []
  })
  const inCover = cover?.setting_value === source
  return {
    affected,
    coverVersion: inCover ? cover!.version : null,
    references: affected.reduce((total, row) => total + row.references, 0) + (inCover ? 1 : 0),
  }
}
async function checkUser(workspaceId: string, action: 'workspace:read' | 'entity:delete') {
  const user = await currentCloudUser()
  if (!user) return { user: null, status: 401 }
  return { user, status: await authorizedWorkspace(user, workspaceId, action) ? 200 : 404 }
}
async function loadReferences(client: { query: typeof pool.query }, workspaceId: string, lock = false) {
  const [entities, cover] = await Promise.all([
    client.query<EntityRow>(
      `SELECT id,title,kind,version,content FROM entities
       WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
      [workspaceId]),
    client.query<CoverRow>(
      `SELECT version,setting_value FROM workspace_settings
       WHERE workspace_id=$1 AND setting_key='world-cover'${lock ? ' FOR UPDATE' : ''}`,
      [workspaceId]),
  ])
  return { entities: entities.rows, cover: cover.rows[0] }
}
function error(status: number, code: string) {
  return NextResponse.json({ error: code }, { status })
}
export async function GET(_request: Request, context: Context) {
  const { workspaceId, assetId } = await context.params
  if (!isUuid(workspaceId) || !isUuid(assetId)) return error(404, 'NOT_FOUND')
  const access = await checkUser(workspaceId, 'workspace:read')
  if (access.status !== 200) return error(access.status, 'NOT_FOUND')
  const asset = await pool.query('SELECT id FROM media_assets WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL',
    [workspaceId, assetId])
  if (!asset.rowCount) return error(404, 'NOT_FOUND')
  const { entities, cover } = await loadReferences(pool, workspaceId)
  const preview = analyze(entities, cover, '/api/media/' + assetId)
  return NextResponse.json(preview, { headers: { 'Cache-Control': 'private, no-store' } })
}
async function mutate(request: Request, context: Context, replacement: boolean) {
  if (!mutationOriginAllowed(request)) return error(403, 'INVALID_ORIGIN')
  const { workspaceId, assetId } = await context.params
  if (!isUuid(workspaceId) || !isUuid(assetId)) return error(404, 'NOT_FOUND')
  const access = await checkUser(workspaceId, 'entity:delete')
  if (access.status !== 200 || !access.user) return error(access.status, 'NOT_FOUND')
  const input: unknown = await request.json().catch(() => null)
  if (!input || typeof input !== 'object' || Array.isArray(input)) return error(400, 'INVALID_INPUT')
  const data = input as Record<string, unknown>
  if (data.confirmEverywhere !== true || !data.expectedVersions ||
      typeof data.expectedVersions !== 'object' || Array.isArray(data.expectedVersions) ||
      Object.keys(data.expectedVersions).length > MAX_AFFECTED ||
      (data.coverVersion !== null && (!Number.isSafeInteger(data.coverVersion) ||
       (data.coverVersion as number) < 0))) return error(400, 'INVALID_CONFIRMATION')
  const expectedVersions = data.expectedVersions as Record<string, unknown>
  const nextId = replacement ? data.replaceWith : null
  if (replacement && (!isUuid(nextId) || nextId === assetId)) return error(400, 'INVALID_REPLACEMENT')
  const oldUrl = '/api/media/' + assetId
  const newUrl = replacement ? '/api/media/' + nextId : null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM workspaces WHERE id=$1 AND deleted_at IS NULL FOR NO KEY UPDATE', [workspaceId])
    const asset = await client.query('SELECT id FROM media_assets WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',
      [workspaceId, assetId])
    if (!asset.rowCount) { await client.query('ROLLBACK'); return error(404, 'NOT_FOUND') }
    if (replacement) {
      const next = await client.query(
        'SELECT id FROM media_assets WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',
        [workspaceId, nextId])
      if (!next.rowCount) { await client.query('ROLLBACK'); return error(400, 'INVALID_REPLACEMENT') }
    }
    // Workspace row lock serializes media rewrite with other workspace-level operations.
    const entities = await client.query<EntityRow>(
      `SELECT id,title,kind,version,content FROM entities
       WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY id FOR UPDATE`, [workspaceId])
    const covers = await client.query<CoverRow>(
      `SELECT version,setting_value FROM workspace_settings
       WHERE workspace_id=$1 AND setting_key='world-cover' FOR UPDATE`, [workspaceId])
    const cover = covers.rows[0]
    const preview = analyze(entities.rows, cover, oldUrl)
    if (preview.affected.length > MAX_AFFECTED ||
        preview.affected.length !== Object.keys(expectedVersions).length ||
        preview.affected.some(row => expectedVersions[row.id] !== row.version) ||
        preview.coverVersion !== data.coverVersion) {
      await client.query('ROLLBACK')
      return error(409, 'VERSION_CONFLICT')
    }
    for (const row of entities.rows) {
      if (!(row.id in expectedVersions)) continue
      const converted = rewriteMediaReferences(row.content, oldUrl, newUrl)
      if (!converted.references) continue
      const version = row.version + 1
      await client.query(
        `UPDATE entities SET content=$1::jsonb,version=$2,updated_by=$3,updated_at=now()
         WHERE id=$4 AND workspace_id=$5`,
        [JSON.stringify(converted.value), version, access.user.id, row.id, workspaceId])
    }
    if (preview.coverVersion !== null) {
      await client.query(
        `UPDATE workspace_settings SET setting_value=$1::jsonb,version=version+1,updated_at=now()
         WHERE workspace_id=$2 AND setting_key='world-cover'`,
        [JSON.stringify(newUrl ?? ''), workspaceId])
    }
    // Keep file bytes for disaster recovery/backup retention; authorization immediately
    // prevents further access through /api/media/<id>.
    await client.query('UPDATE media_assets SET deleted_at=now() WHERE id=$1 AND workspace_id=$2',
      [assetId, workspaceId])
    await client.query(
      `INSERT INTO audit_logs(workspace_id,actor_id,action,target_id,details)
       VALUES($1,$2,$3,$4,$5::jsonb)`,
      [workspaceId, access.user.id, replacement ? 'media:replace:everywhere' : 'media:delete:everywhere',
        assetId, JSON.stringify({ affected: preview.affected.length, references: preview.references, nextId })])
    await client.query('COMMIT')
    return NextResponse.json({ deleted: true, replaced: replacement, affected: preview.affected.length,
      references: preview.references })
  } catch (cause) {
    await client.query('ROLLBACK')
    throw cause
  } finally { client.release() }
}
export async function DELETE(request: Request, context: Context) { return mutate(request, context, false) }
export async function PATCH(request: Request, context: Context) { return mutate(request, context, true) }

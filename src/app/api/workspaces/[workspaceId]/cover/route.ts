import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { cloudMediaUrlId } from '@/lib/cloud/character-media'
import { pool } from '@/lib/cloud/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ workspaceId: string }> }
type CoverRow = { setting_value: unknown; version: number }

/** The original world-cover field is persisted as versioned workspace settings. */
export async function GET(_request: Request, context: Context) {
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId } = await context.params
  if (!await authorizedWorkspace(user, workspaceId, 'workspace:read')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const found = await pool.query<CoverRow>(
    "SELECT setting_value,version FROM workspace_settings WHERE workspace_id=$1 AND setting_key='world-cover'",
    [workspaceId],
  )
  const row = found.rows[0]
  return NextResponse.json({
    coverUrl: typeof row?.setting_value === 'string' ? row.setting_value : '', version: row?.version ?? 0,
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function PATCH(request: Request, context: Context) {
  if (!mutationOriginAllowed(request)) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId } = await context.params
  if (!await authorizedWorkspace(user, workspaceId, 'workspace:update')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const raw: unknown = await request.json().catch(() => null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json({ error: 'INVALID_COVER' }, { status: 400 })
  }
  const { expectedVersion, coverUrl } = raw as Record<string, unknown>
  if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 0 ||
      typeof coverUrl !== 'string' ||
      (coverUrl !== '' && cloudMediaUrlId(coverUrl) === null)) {
    return NextResponse.json({ error: 'INVALID_COVER' }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR NO KEY UPDATE', [workspaceId])
    const rows = await client.query<CoverRow>(
      "SELECT setting_value,version FROM workspace_settings WHERE workspace_id=$1 AND setting_key='world-cover' FOR UPDATE",
      [workspaceId],
    )
    const current = rows.rows[0]
    const version = current?.version ?? 0
    if (expectedVersion !== version) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'VERSION_CONFLICT', actualVersion: version }, { status: 409 })
    }
    if (coverUrl) {
      const assetId = cloudMediaUrlId(coverUrl)!
      const allowed = await client.query(
        'SELECT 1 FROM media_assets WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL',
        [assetId, workspaceId],
      )
      if (allowed.rowCount !== 1) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'INVALID_COVER_MEDIA' }, { status: 400 })
      }
    }
    if (current?.setting_value === coverUrl) {
      await client.query('COMMIT')
      return NextResponse.json({ coverUrl, version, unchanged: true })
    }
    const result = await client.query<{ version: number }>(
      `INSERT INTO workspace_settings(workspace_id,setting_key,setting_value,version)
       VALUES($1,'world-cover',$2::jsonb,1)
       ON CONFLICT(workspace_id,setting_key) DO UPDATE SET
       setting_value=EXCLUDED.setting_value,version=workspace_settings.version+1,updated_at=now()
       RETURNING version`,
      [workspaceId, JSON.stringify(coverUrl)],
    )
    await client.query(
      `INSERT INTO audit_logs(workspace_id,actor_id,action,target_id,details)
       VALUES($1,$2,'workspace:cover:update',$4,$3::jsonb)`,
      [workspaceId, user.id, JSON.stringify({ before: current?.setting_value ?? '', after: coverUrl }), workspaceId],
    )
    await client.query('COMMIT')
    return NextResponse.json({ coverUrl, version: result.rows[0].version })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { pool } from '@/lib/cloud/server/db'
import { readDesktopArchiveExtras } from '@/lib/cloud/backup-format'
import { MAX_CLOUD_PERIODS, readPeriodFields, readWorkspacePeriods } from '@/lib/cloud/periods'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ workspaceId: string }> }
const emptyExtras = () => ({ periods: [], meta: [] })
const headers = { 'Cache-Control': 'private, no-store' }
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers })

export async function GET(_request: Request, context: Context) {
  const user = await currentCloudUser()
  if (!user) return fail('UNAUTHORIZED', 401)
  const { workspaceId } = await context.params
  if (!isUuid(workspaceId) || !await authorizedWorkspace(user, workspaceId, 'entity:read'))
    return fail('NOT_FOUND', 404)
  const result = await pool.query<{ setting_value: unknown; version: number }>(
    "SELECT setting_value,version FROM workspace_settings WHERE workspace_id=$1 AND setting_key='desktop-extras'",
    [workspaceId])
  const row = result.rows[0]
  const extras = row ? readDesktopArchiveExtras(row.setting_value) : emptyExtras()
  const periods = extras && readWorkspacePeriods(extras.periods)
  if (!periods) return fail('INVALID_SAVED_PERIODS', 409)
  return NextResponse.json({ periods, version: row?.version ?? 0 }, { headers })
}

export async function POST(request: Request, context: Context) {
  if (!mutationOriginAllowed(request)) return fail('INVALID_ORIGIN', 403)
  const user = await currentCloudUser()
  if (!user) return fail('UNAUTHORIZED', 401)
  const { workspaceId } = await context.params
  if (!isUuid(workspaceId) || !await authorizedWorkspace(user, workspaceId, 'entity:update'))
    return fail('NOT_FOUND', 404)
  const rawText = await request.text()
  if (rawText.length > 3000) return fail('INVALID_PERIOD', 413)
  let raw: unknown
  try { raw = JSON.parse(rawText) } catch { return fail('INVALID_PERIOD', 400) }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('INVALID_PERIOD', 400)
  const body = raw as Record<string, unknown>
  if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0 ||
      !['create', 'update', 'delete'].includes(String(body.operation))) return fail('INVALID_PERIOD', 400)
  const isCreate = body.operation === 'create'
  if (!isCreate && (!Number.isSafeInteger(body.id) || Number(body.id) <= 0))
    return fail('INVALID_PERIOD', 400)
  const fields = body.operation === 'delete' ? null : readPeriodFields(body.period)
  if (body.operation !== 'delete' && !fields) return fail('INVALID_PERIOD', 400)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const active = await client.query(
      'SELECT id FROM workspaces WHERE id=$1 AND deleted_at IS NULL FOR NO KEY UPDATE', [workspaceId])
    if (active.rowCount !== 1) {
      await client.query('ROLLBACK')
      return fail('NOT_FOUND', 404)
    }
    const found = await client.query<{ setting_value: unknown; version: number }>(
      "SELECT setting_value,version FROM workspace_settings WHERE workspace_id=$1 AND setting_key='desktop-extras' FOR UPDATE",
      [workspaceId])
    const row = found.rows[0]
    const version = row?.version ?? 0
    if (version !== body.expectedVersion) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'VERSION_CONFLICT', actualVersion: version },
        { status: 409, headers })
    }
    const extras = row ? readDesktopArchiveExtras(row.setting_value) : emptyExtras()
    const periods = extras && readWorkspacePeriods(extras.periods)
    if (!extras || !periods) {
      await client.query('ROLLBACK')
      return fail('INVALID_SAVED_PERIODS', 409)
    }
    let next: unknown[] = [...extras.periods]
    let changedId: number
    if (isCreate) {
      if (periods.length >= MAX_CLOUD_PERIODS) {
        await client.query('ROLLBACK')
        return fail('PERIOD_LIMIT_REACHED', 413)
      }
      const maxId = next.reduce<number>((max, item) => {
        if (!item || typeof item !== 'object') return max
        const id = (item as { id?: unknown }).id
        return Number.isSafeInteger(id) ? Math.max(max, Number(id)) : max
      }, 0)
      if (!Number.isSafeInteger(maxId + 1)) {
        await client.query('ROLLBACK')
        return fail('PERIOD_LIMIT_REACHED', 413)
      }
      changedId = maxId + 1
      next.push({ id: changedId, ...fields! })
    } else {
      changedId = Number(body.id)
      if (!periods.some(period => period.id === changedId)) {
        await client.query('ROLLBACK')
        return fail('PERIOD_NOT_FOUND', 404)
      }
      next = next.map(item => {
        if (!item || typeof item !== 'object' || (item as { id?: unknown }).id !== changedId)
          return item
        return body.operation === 'delete'
          ? { ...item, deleted: true }
          : { ...item, ...fields, deleted: false }
      })
    }
    const result = await client.query<{ version: number }>(
      "INSERT INTO workspace_settings(workspace_id,setting_key,setting_value,version) " +
      "VALUES($1,'desktop-extras',$2::jsonb,1) " +
      "ON CONFLICT (workspace_id,setting_key) DO UPDATE SET " +
      "setting_value=EXCLUDED.setting_value,version=workspace_settings.version+1,updated_at=now() " +
      "RETURNING version",
      [workspaceId, JSON.stringify({ ...extras, periods: next })])
    await client.query(
      "INSERT INTO audit_logs(workspace_id,actor_id,action,target_id,details) " +
      "VALUES($1,$2,$3,$4,$5::jsonb)",
      [workspaceId, user.id, 'workspace:period:' + body.operation, workspaceId,
        JSON.stringify({ periodId: changedId, version: result.rows[0].version })])
    await client.query('COMMIT')
    return NextResponse.json({
      periods: readWorkspacePeriods(next), version: result.rows[0].version,
    }, { headers })
  } catch (cause) {
    await client.query('ROLLBACK')
    throw cause
  } finally {
    client.release()
  }
}

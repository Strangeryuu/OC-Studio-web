import { NextResponse } from 'next/server'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import {
  parseCloudCharacterConfig,
} from '@/lib/cloud/character-config'
import { loadCloudCharacterConfig } from '@/lib/cloud/server/character-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ workspaceId: string }> }

export async function GET(_request: Request, context: Context) {
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId } = await context.params
  if (!await authorizedWorkspace(user, workspaceId, 'workspace:read')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  return NextResponse.json(await loadCloudCharacterConfig(workspaceId), {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

export async function PATCH(request: Request, context: Context) {
  if (!mutationOriginAllowed(request)) {
    return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  }
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId } = await context.params
  if (!await authorizedWorkspace(user, workspaceId, 'workspace:update')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  const input: unknown = await request.json().catch(() => null)
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }
  const body = input as Record<string, unknown>
  const expected = body.expectedVersion
  const config = parseCloudCharacterConfig(body.config)
  if (!config || typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0) {
    return NextResponse.json({ error: 'INVALID_CONFIG' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const previous = await client.query<{ setting_value: unknown; version: number }>(
      "SELECT setting_value,version FROM workspace_settings WHERE workspace_id=$1 AND setting_key='character-config' FOR UPDATE",
      [workspaceId],
    )
    const current = previous.rows[0]
    if ((current?.version ?? 0) !== expected) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'VERSION_CONFLICT', actualVersion: current?.version ?? 0 }, { status: 409 })
    }
    const nextVersion = expected + 1
    if (!Number.isSafeInteger(nextVersion)) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'VERSION_OVERFLOW' }, { status: 400 })
    }
    if (current) {
      await client.query(
        "UPDATE workspace_settings SET setting_value=$3::jsonb,version=$4,updated_at=now() WHERE workspace_id=$1 AND setting_key=$2",
        [workspaceId, 'character-config', JSON.stringify(config), nextVersion],
      )
    } else {
      const inserted = await client.query(
        "INSERT INTO workspace_settings(workspace_id,setting_key,setting_value,version) VALUES($1,'character-config',$2::jsonb,1) ON CONFLICT DO NOTHING RETURNING version",
        [workspaceId, JSON.stringify(config)],
      )
      if (inserted.rowCount !== 1) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'VERSION_CONFLICT', actualVersion: null }, { status: 409 })
      }
    }
    await client.query(
      "INSERT INTO audit_logs(workspace_id,actor_id,action,details) VALUES($1,$2,'character-config:update',$3::jsonb)",
      [workspaceId, user.id, JSON.stringify({ version: nextVersion, before: current?.setting_value ?? null, after: config })],
    )
    await client.query('COMMIT')
    return NextResponse.json({ config, version: nextVersion })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

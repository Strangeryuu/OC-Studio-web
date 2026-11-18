import { NextResponse } from 'next/server'
import type { PoolClient } from 'pg'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { pool } from '@/lib/cloud/server/db'
import { readExpectedVersion } from '@/lib/cloud/entity-input'
import { MAP_CATEGORY } from '@/lib/entry-kinds'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ workspaceId: string; mapEntityId: string }> }
type MapRow = { id: string; title: string; content: Record<string, unknown>; version: number }
type PinRow = { id: string; kind: string; title: string; content: Record<string, unknown>; version: number }

async function appendRevision(
  client: PoolClient, row: MapRow | PinRow, actorId: string,
  action: 'update' | 'delete', nextTitle: string, nextContent: Record<string, unknown>,
  summary: string,
) {
  const version = row.version + 1
  const before = { title: row.title, data: row.content }
  const after = { title: nextTitle, data: nextContent }
  if (action === 'delete') {
    await client.query(
      `UPDATE entities SET version=$1,updated_by=$2,updated_at=now(),deleted_at=now() WHERE id=$3`,
      [version, actorId, row.id],
    )
  } else {
    await client.query(
      `UPDATE entities SET title=$1,content=$2::jsonb,version=$3,updated_by=$4,updated_at=now() WHERE id=$5`,
      [nextTitle, JSON.stringify(nextContent), version, actorId, row.id],
    )
  }
  await client.query(
    `INSERT INTO entity_revisions(entity_id,version,actor_id,action,summary,content_snapshot)
     VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [row.id, version, actorId, action, summary, JSON.stringify(action === 'delete' ? before : after)],
  )
  await client.query(
    `INSERT INTO change_events(entity_id,version,actor_id,action,changes)
     VALUES($1,$2,$3,$4,$5::jsonb)`,
    [row.id, version, actorId, action, JSON.stringify([{ field: 'document', oldValue: before, newValue: action === 'delete' ? null : after }])],
  )
  return version
}

async function withMap(
  request: Request, context: Context, action: 'entity:update' | 'entity:delete',
  operation: (client: PoolClient, row: MapRow, userId: string, workspaceId: string) => Promise<NextResponse>,
) {
  if (!mutationOriginAllowed(request)) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId, mapEntityId } = await context.params
  if (!isUuid(mapEntityId) || !await authorizedWorkspace(user, workspaceId, action)) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Map management and regular pin mutations acquire the same workspace lock first.
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR NO KEY UPDATE', [workspaceId])
    const found = await client.query<MapRow>(
      `SELECT id,title,content,version FROM entities WHERE id=$1 AND workspace_id=$2
       AND kind='worldEntry' AND content->>'category'=$3 AND deleted_at IS NULL FOR UPDATE`,
      [mapEntityId, workspaceId, MAP_CATEGORY],
    )
    const row = found.rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    }
    const result = await operation(client, row, user.id, workspaceId)
    if (result.status >= 400) await client.query('ROLLBACK')
    else await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

async function linkedPins(client: PoolClient, workspaceId: string, mapId: string, mapEntityId: string) {
  return client.query<PinRow>(
    `SELECT id,kind,title,content,version FROM entities
     WHERE workspace_id=$1 AND id<>$2 AND deleted_at IS NULL
       AND kind IN ('country','event','worldEntry') AND content->>'mapId'=$3
     ORDER BY id FOR UPDATE`,
    [workspaceId, mapEntityId, mapId],
  )
}

export async function PATCH(request: Request, context: Context) {
  const raw: unknown = await request.json().catch(() => null)
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const expected = readExpectedVersion(body.expectedVersion)
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!expected || !name || name.length > 200) return NextResponse.json({ error: 'INVALID_MAP_NAME' }, { status: 400 })
  return withMap(request, context, 'entity:update', async (client, row, userId, workspaceId) => {
    if (row.version !== expected) return NextResponse.json({ error: 'VERSION_CONFLICT', actualVersion: row.version }, { status: 409 })
    if (name === row.title) return NextResponse.json({ version: row.version, renamedPins: 0, unchanged: true })
    const collision = await client.query(
      `SELECT id FROM entities WHERE workspace_id=$1 AND kind='worldEntry'
       AND content->>'category'=$2 AND title=$3 AND deleted_at IS NULL LIMIT 1`,
      [workspaceId, MAP_CATEGORY, name],
    )
    if (collision.rowCount) return NextResponse.json({ error: 'MAP_NAME_TAKEN' }, { status: 409 })
    const pins = await linkedPins(client, workspaceId, row.title, row.id)
    const now = Date.now()
    const mapVersion = await appendRevision(client, row, userId, 'update', name,
      { ...row.content, title: name, updatedAt: now }, `重命名地图：${row.title} → ${name}`)
    for (const pin of pins.rows) {
      await appendRevision(client, pin, userId, 'update', pin.title,
        { ...pin.content, mapId: name, updatedAt: now },
        `地图重命名：${row.title} → ${name}`)
    }
    return NextResponse.json({ version: mapVersion, renamedPins: pins.rows.length })
  })
}

export async function DELETE(request: Request, context: Context) {
  const raw: unknown = await request.json().catch(() => null)
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const expected = readExpectedVersion(body.expectedVersion)
  if (!expected) return NextResponse.json({ error: 'INVALID_VERSION' }, { status: 400 })
  return withMap(request, context, 'entity:delete', async (client, row, userId, workspaceId) => {
    if (row.version !== expected) return NextResponse.json({ error: 'VERSION_CONFLICT', actualVersion: row.version }, { status: 409 })
    const pins = await linkedPins(client, workspaceId, row.title, row.id)
    const now = Date.now()
    for (const pin of pins.rows) {
      await appendRevision(client, pin, userId, 'update', pin.title,
        { ...pin.content, mapId: null, mapPosition: null, updatedAt: now },
        `删除地图「${row.title}」时移除锚点`)
    }
    const mapVersion = await appendRevision(client, row, userId, 'delete', row.title, row.content,
      `删除地图：${row.title}`)
    return NextResponse.json({ deleted: true, version: mapVersion, removedPins: pins.rows.length })
  })
}

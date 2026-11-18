import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { NextResponse } from 'next/server'
import { entityAccess } from '@/lib/cloud/server/entity-access'
import { pool } from '@/lib/cloud/server/db'
import { readEntityDocument, readExpectedVersion } from '@/lib/cloud/entity-input'
import { planEntityUpdate, type JsonValue } from '@/lib/cloud/versioning'
import { characterMediaAllowed } from '@/lib/cloud/server/character-media'
import { characterLinksAllowed } from '@/lib/cloud/server/character-links'
import { eventLinksAllowed } from '@/lib/cloud/server/original-links'
import { worldLinksAllowed } from '@/lib/cloud/server/world-links'
import { cloudMapAllowed } from '@/lib/cloud/map-fields'
import { MAP_CATEGORY } from '@/lib/entry-kinds'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ entityId: string }> }

export async function GET(_req: Request, context: Context) {
  const { entityId } = await context.params
  const access = await entityAccess(entityId, 'entity:read')
  if (access.status !== 200) return NextResponse.json({ error: access.status === 401 ? 'UNAUTHORIZED' : 'NOT_FOUND' }, { status: access.status })
  const result = await pool.query(
    `SELECT id,workspace_id,kind,title,content,version,updated_at
       FROM entities WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`,
    [entityId, access.workspaceId],
  )
  if (!result.rows[0]) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ entity: result.rows[0] })
}

export async function PATCH(request: Request, context: Context) {
  if (!mutationOriginAllowed(request)) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  const { entityId } = await context.params
  const access = await entityAccess(entityId, 'entity:update', request.headers.get('X-OC-Workspace-Id'))
  if (access.status !== 200) return NextResponse.json({ error: access.status === 401 ? 'UNAUTHORIZED' : 'NOT_FOUND' }, { status: access.status })
  const body: unknown = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }
  const fields = body as Record<string, unknown>
  const expectedVersion = readExpectedVersion(fields.expectedVersion)
  const document = readEntityDocument(fields)
  if (expectedVersion === null || !document) {
    return NextResponse.json({ error: 'INVALID_DOCUMENT' }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR NO KEY UPDATE', [access.workspaceId])
    const found = await client.query<{ version: number; title: string; content: JsonValue; kind: string }>(
      `SELECT kind,version,title,content FROM entities
       WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL FOR UPDATE`,
      [entityId, access.workspaceId],
    )
    const existing = found.rows[0]
    if (!existing) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    }
    const previousMap = existing.kind === 'worldEntry' &&
      (existing.content as Record<string, unknown>).category === MAP_CATEGORY
    const updatedContent = document.data as Record<string, unknown>
    if (previousMap && (document.title !== existing.title || updatedContent.category !== MAP_CATEGORY ||
      updatedContent.title !== existing.title)) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'MAP_MANAGEMENT_REQUIRED' }, { status: 400 })
    }
    if (!await characterMediaAllowed(client, access.workspaceId, existing.kind, document.data)) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: existing.kind === 'worldEntry' ? 'INVALID_NOTE_MEDIA' : existing.kind === 'event' ? 'INVALID_EVENT_MEDIA' : existing.kind === 'country' ? 'INVALID_COUNTRY_MEDIA' : 'INVALID_CHARACTER_MEDIA' }, { status: 400 })
    }
    if (!await cloudMapAllowed(client, access.workspaceId, existing.kind, document.data, document.title, entityId)) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'INVALID_MAP_FIELDS' }, { status: 400 })
    }
    if (existing.kind === 'event' && !await eventLinksAllowed(client, access.workspaceId, document.data, entityId, existing.content)) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'INVALID_EVENT_LINKS' }, { status: 400 })
    }
    if (!await worldLinksAllowed(client, access.workspaceId, existing.kind, document.data, entityId, existing.content)) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'INVALID_NOTE_LINKS' }, { status: 400 })
    }
    if (!await characterLinksAllowed(client, access.workspaceId, existing.kind, document.data, entityId, existing.content)) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'INVALID_CHARACTER_LINKS' }, { status: 400 })
    }
    const original = { title: existing.title, data: existing.content }
    const plan = planEntityUpdate({
      current: { id: entityId, workspaceId: access.workspaceId, version: existing.version, content: original },
      expectedVersion, nextContent: { title: document.title, data: document.data }, actorId: access.user.id,
      createdAt: new Date().toISOString(),
    })
    if (plan.kind === 'conflict') {
      await client.query('ROLLBACK')
      return NextResponse.json({
        error: 'VERSION_CONFLICT', actualVersion: plan.actualVersion, expectedVersion,
      }, { status: 409 })
    }
    if (plan.kind === 'unchanged') {
      await client.query('COMMIT')
      return NextResponse.json({ version: existing.version, unchanged: true })
    }
    await client.query(
      `UPDATE entities SET title=$1,content=$2::jsonb,version=$3,updated_by=$4,updated_at=now()
       WHERE id=$5 AND workspace_id=$6`,
      [document.title, JSON.stringify(document.data), plan.next.version, access.user.id, entityId, access.workspaceId],
    )
    await client.query(
      `INSERT INTO entity_revisions(entity_id,version,actor_id,action,content_snapshot)
       VALUES($1,$2,$3,'update',$4::jsonb)`,
      [entityId, plan.next.version, access.user.id, JSON.stringify(document)],
    )
    await client.query(
      `INSERT INTO change_events(entity_id,version,actor_id,action,changes)
       VALUES($1,$2,$3,'update',$4::jsonb)`,
      [entityId, plan.next.version, access.user.id, JSON.stringify([
        { field: 'document', oldValue: original, newValue: document },
      ])],
    )
    await client.query('COMMIT')
    return NextResponse.json({ entityId, version: plan.next.version })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

export async function DELETE(request: Request, context: Context) {
  if (!mutationOriginAllowed(request)) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  const { entityId } = await context.params
  const access = await entityAccess(entityId, 'entity:delete', request.headers.get('X-OC-Workspace-Id'))
  if (access.status !== 200) return NextResponse.json({ error: access.status === 401 ? 'UNAUTHORIZED' : 'NOT_FOUND' }, { status: access.status })
  const body: unknown = await request.json().catch(() => null)
  const expected = body && typeof body === 'object' && !Array.isArray(body)
    ? readExpectedVersion((body as Record<string, unknown>).expectedVersion) : null
  if (!expected) return NextResponse.json({ error: 'INVALID_VERSION' }, { status: 400 })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{ version: number; title: string; content: JsonValue; kind: string }>(
      `SELECT kind,version,title,content FROM entities
       WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL FOR UPDATE`, [entityId, access.workspaceId],
    )
    const row = result.rows[0]
    if (!row) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 }) }
    if (row.kind === 'worldEntry' && (row.content as Record<string, unknown>).category === MAP_CATEGORY) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'MAP_MANAGEMENT_REQUIRED' }, { status: 400 })
    }
    if (expected !== row.version) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'VERSION_CONFLICT', actualVersion: row.version }, { status: 409 }) }
    const nextVersion = row.version + 1
    await client.query(
      `UPDATE entities SET version=$1,updated_by=$2,updated_at=now(),deleted_at=now()
       WHERE id=$3 AND workspace_id=$4`, [nextVersion, access.user.id, entityId, access.workspaceId],
    )
    await client.query(
      `INSERT INTO entity_revisions(entity_id,version,actor_id,action,content_snapshot)
       VALUES($1,$2,$3,'delete',$4::jsonb)`,
      [entityId, nextVersion, access.user.id, JSON.stringify({ title: row.title, data: row.content })],
    )
    await client.query(
      "INSERT INTO change_events(entity_id,version,actor_id,action) VALUES($1,$2,$3,'delete')",
      [entityId, nextVersion, access.user.id],
    )
    await client.query('COMMIT')
    return NextResponse.json({ entityId, version: nextVersion, deleted: true })
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}

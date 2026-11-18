import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { NextResponse } from 'next/server'
import { worldLinksAllowed } from '@/lib/cloud/server/world-links'
import { cloudMapAllowed } from '@/lib/cloud/map-fields'
import { characterMediaAllowed } from '@/lib/cloud/server/character-media'
import { entityAccess } from '@/lib/cloud/server/entity-access'
import { pool } from '@/lib/cloud/server/db'
import { readEntityDocument, readExpectedVersion } from '@/lib/cloud/entity-input'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ entityId: string }> }) {
  if (!mutationOriginAllowed(request)) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  const { entityId } = await context.params
  const access = await entityAccess(entityId, 'entity:restore')
  if (access.status !== 200) return NextResponse.json({ error: access.status === 401 ? 'UNAUTHORIZED' : 'NOT_FOUND' }, { status: access.status })
  const body: unknown = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }
  const b = body as Record<string, unknown>
  const expectedVersion = readExpectedVersion(b.expectedVersion)
  const restoreVersion = readExpectedVersion(b.restoreVersion)
  if (expectedVersion === null || restoreVersion === null) {
    return NextResponse.json({ error: 'INVALID_VERSION' }, { status: 400 })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR NO KEY UPDATE', [access.workspaceId])
    const existing = await client.query<{ version: number; kind: string; content: unknown }>(
      'SELECT version,kind,content FROM entities WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [entityId, access.workspaceId],
    )
    const row = existing.rows[0]
    if (!row) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 }) }
    if (row.version !== expectedVersion) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'VERSION_CONFLICT', actualVersion: row.version }, { status: 409 })
    }
    const rev = await client.query<{ content_snapshot: unknown }>(
      'SELECT content_snapshot FROM entity_revisions WHERE entity_id=$1 AND version=$2',
      [entityId, restoreVersion],
    )
    const snapshot = readEntityDocument(rev.rows[0]?.content_snapshot)
    if (!snapshot) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'REVISION_NOT_FOUND' }, { status: 404 })
    }
    if (!await cloudMapAllowed(client, access.workspaceId, row.kind, snapshot.data, snapshot.title, entityId)) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'INVALID_MAP_FIELDS' }, { status: 400 })
    }
    if (!await characterMediaAllowed(client, access.workspaceId, row.kind, snapshot.data)) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'INVALID_RESTORED_MEDIA' }, { status: 400 })
    }
    if (row.kind === 'worldEntry' && !await worldLinksAllowed(
      client, access.workspaceId, row.kind, snapshot.data, entityId, row.content,
    )) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'INVALID_NOTE_LINKS' }, { status: 400 })
    }
    const nextVersion = row.version + 1
    await client.query(
      `UPDATE entities SET title=$1,content=$2::jsonb,version=$3,deleted_at=NULL,
      updated_by=$4,updated_at=now() WHERE id=$5 AND workspace_id=$6`,
      [snapshot.title, JSON.stringify(snapshot.data), nextVersion, access.user.id, entityId, access.workspaceId],
    )
    await client.query(
      `INSERT INTO entity_revisions(entity_id,version,actor_id,action,summary,content_snapshot)
       VALUES($1,$2,$3,'restore',$4,$5::jsonb)`,
      [entityId, nextVersion, access.user.id, 'Restored version ' + restoreVersion, JSON.stringify(snapshot)],
    )
    await client.query(
      `INSERT INTO change_events(entity_id,version,actor_id,action,changes)
       VALUES($1,$2,$3,'restore',$4::jsonb)`,
      [entityId, nextVersion, access.user.id, JSON.stringify([{ restoreVersion }])],
    )
    await client.query('COMMIT')
    return NextResponse.json({ entityId, version: nextVersion, restoredFrom: restoreVersion })
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}

import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { pool } from '@/lib/cloud/server/db'
import { isCodexEntry } from '@/lib/entry-kinds'
import { readExpectedVersion } from '@/lib/cloud/entity-input'
import { parseOriginalId } from '@/lib/cloud/original-ids'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ workspaceId: string; entityId: string }> }
type Row = {
  id: string; local_id: string | number; kind: string; title: string
  content: Record<string, unknown>; version: number
}
const TABLE_KINDS = new Set(['character','country','event','worldEntry'])
const MAX_AFFECTED = 400
const MAX_VERSIONS = 8000

function changedRows(rows: Row[], target: Row): Array<{ row: Row; next: Record<string, unknown> }> | null {
  const localId = parseOriginalId(String(target.local_id))
  if (localId == null) return null
  const parentId = target.content.parentId ?? null
  const changes: Array<{ row: Row; next: Record<string, unknown> }> = []
  for (const row of rows) {
    if (row.id === target.id) continue
    const next = { ...row.content }
    let changed = false
    if ((target.kind === 'country' || target.kind === 'worldEntry') &&
        row.kind === target.kind && row.content.parentId === localId) {
      // Preserve the original table's child-promotion semantics.
      if (target.kind === 'worldEntry' && !isCodexEntry(row.content)) return null
      next.parentId = parentId
      next.updatedAt = Date.now()
      changed = true
    }
    if (target.kind === 'country') {
      if (row.kind === 'character' && row.content.countryId === localId) {
        next.countryId = null
        changed = true
      }
      if (row.kind === 'event' && Array.isArray(row.content.countries) &&
          row.content.countries.includes(localId)) {
        next.countries = row.content.countries.filter(id => id !== localId)
        changed = true
      }
    }
    if (target.kind === 'character') {
      if (row.kind === 'event' && Array.isArray(row.content.characters) &&
          row.content.characters.includes(localId)) {
        next.characters = row.content.characters.filter(id => id !== localId)
        changed = true
      }
      if (row.kind === 'character' && Array.isArray(row.content.relatedCharacters)) {
        const retained = row.content.relatedCharacters.filter(item =>
          !item || typeof item !== 'object' || (item as Record<string, unknown>).characterId !== localId)
        if (retained.length !== row.content.relatedCharacters.length) {
          next.relatedCharacters = retained
          changed = true
        }
      }
    }
    if (changed) changes.push({ row, next })
  }
  return changes
}

/** Child promotion, original membership cleanup, soft-delete and history in one transaction. */
export async function DELETE(request: Request, context: Context) {
  if (!mutationOriginAllowed(request)) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId, entityId } = await context.params
  if (!isUuid(workspaceId) || !isUuid(entityId) ||
      !await authorizedWorkspace(user, workspaceId, 'entity:delete')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const input: unknown = await request.json().catch(() => null)
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return NextResponse.json({ error: 'INVALID_DOCUMENT' }, { status: 400 })
  }
  const values = input as Record<string, unknown>
  const expectedVersion = readExpectedVersion(values.expectedVersion)
  const expectedVersions = values.expectedVersions
  if (expectedVersion === null || !expectedVersions ||
      typeof expectedVersions !== 'object' || Array.isArray(expectedVersions) ||
      Object.keys(expectedVersions).length > MAX_VERSIONS) {
    return NextResponse.json({ error: 'INVALID_VERSION' }, { status: 400 })
  }
  const versions = expectedVersions as Record<string, unknown>
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR NO KEY UPDATE', [workspaceId])
    const read = await client.query<Row>(
      `SELECT id,local_id,kind,title,content,version FROM entities
       WHERE workspace_id=$1 AND kind=ANY($2::text[]) AND deleted_at IS NULL
       ORDER BY local_id FOR UPDATE`,
      [workspaceId, [...TABLE_KINDS]],
    )
    const rows = read.rows
    const target = rows.find(row => row.id === entityId)
    if (!target || (target.kind === 'worldEntry' && !isCodexEntry(target.content))) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    }
    if (target.version !== expectedVersion) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'VERSION_CONFLICT', entityId, actualVersion: target.version }, { status: 409 })
    }
    const updates = changedRows(rows, target)
    if (!updates || updates.length > MAX_AFFECTED) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'TABLE_DELETE_CONFLICT' }, { status: 409 })
    }
    for (const { row } of updates) {
      if (versions[row.id] !== row.version) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'VERSION_CONFLICT', entityId: row.id, actualVersion: row.version }, { status: 409 })
      }
    }
    for (const { row, next } of updates) {
      const version = row.version + 1
      await client.query(
        `UPDATE entities SET content=$1::jsonb,version=$2,updated_by=$3,updated_at=now()
         WHERE id=$4 AND workspace_id=$5`,
        [JSON.stringify(next), version, user.id, row.id, workspaceId],
      )
    }
    const version = target.version + 1
    await client.query(
      `UPDATE entities SET deleted_at=now(),version=$1,updated_by=$2,updated_at=now()
       WHERE id=$3 AND workspace_id=$4`, [version, user.id, target.id, workspaceId],
    )
    await client.query('COMMIT')
    return NextResponse.json({ deleted: true, promotedOrUnlinked: updates.length, version })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

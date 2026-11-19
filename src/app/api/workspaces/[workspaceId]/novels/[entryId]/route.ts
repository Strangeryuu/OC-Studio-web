import { NextResponse } from 'next/server'
import type { PoolClient } from 'pg'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { pool } from '@/lib/cloud/server/db'
import { readExpectedVersion } from '@/lib/cloud/entity-input'
import { NOVEL_CATEGORY } from '@/lib/entry-kinds'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ workspaceId: string; entryId: string }> }
type Row = { id: string; local_id: number; title: string; content: Record<string, unknown>; version: number }
const MAX_DELETE = 1000

/**
 * A book/chapter subtree is a set of original worldEntry rows. Delete it
 * atomically so no child chapters are stranded after a partial network failure.
 */
export async function DELETE(request: Request, context: Context) {
  if (!mutationOriginAllowed(request)) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId, entryId } = await context.params
  if (!isUuid(workspaceId) || !isUuid(entryId) ||
    !await authorizedWorkspace(user, workspaceId, 'entity:delete')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const raw: unknown = await request.json().catch(() => null)
  const expected = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? readExpectedVersion((raw as Record<string, unknown>).expectedVersion) : null
  if (!expected) return NextResponse.json({ error: 'INVALID_VERSION' }, { status: 400 })
  const client: PoolClient = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR NO KEY UPDATE', [workspaceId])
    const result = await client.query<Row>(
      `WITH RECURSIVE subtree AS (
         SELECT id,local_id FROM entities WHERE id=$2 AND workspace_id=$1
           AND kind='worldEntry' AND content->>'category'=$3 AND deleted_at IS NULL
         UNION
         SELECT child.id,child.local_id FROM entities child JOIN subtree parent
           ON child.content->>'parentId'=parent.local_id::text
         WHERE child.workspace_id=$1 AND child.kind='worldEntry'
           AND child.content->>'category'=$3 AND child.deleted_at IS NULL
       )
       SELECT e.id,e.local_id,e.title,e.content,e.version
       FROM entities e JOIN subtree s ON s.id=e.id
       ORDER BY e.local_id FOR UPDATE OF e`,
      [workspaceId, entryId, NOVEL_CATEGORY],
    )
    const rows = result.rows
    const root = rows.find(row => row.id === entryId)
    if (!root) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    }
    if (root.version !== expected) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'VERSION_CONFLICT', actualVersion: root.version }, { status: 409 })
    }
    if (rows.length > MAX_DELETE) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'NOVEL_SUBTREE_TOO_LARGE' }, { status: 413 })
    }
    for (const row of rows) {
      const version = row.version + 1
      await client.query(
        `UPDATE entities SET version=$1,updated_by=$2,updated_at=now(),deleted_at=now()
         WHERE id=$3 AND workspace_id=$4`,
        [version, user.id, row.id, workspaceId],
      )
    }
    await client.query('COMMIT')
    return NextResponse.json({ deleted: true, removedEntries: rows.length })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { pool } from '@/lib/cloud/server/db'
import { NOVEL_CATEGORY } from '@/lib/entry-kinds'
import { planCloudNovelReorder } from '@/lib/cloud/novel-reorder'
import { parseOriginalId } from '@/lib/cloud/original-ids'
import type { WorldEntry } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ workspaceId: string; entryId: string }> }
type Row = { id: string; local_id: string | number; title: string; content: Record<string, unknown>; version: number }
const MAX_CHANGED = 400

/** Atomic original chapter-tree drag: update both sibling lists and record every revision. */
export async function PATCH(request: Request, context: Context) {
  if (!mutationOriginAllowed(request)) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId, entryId } = await context.params
  if (!isUuid(workspaceId) || !isUuid(entryId) ||
      !await authorizedWorkspace(user, workspaceId, 'entity:update')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const raw: unknown = await request.json().catch(() => null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json({ error: 'INVALID_REORDER' }, { status: 400 })
  }
  const input = raw as Record<string, unknown>
  const dragged = parseOriginalId(String(input.draggedId))
  const over = parseOriginalId(String(input.overId))
  const versions = input.expectedVersions
  if (dragged === null || over === null ||
      !versions || typeof versions !== 'object' || Array.isArray(versions) ||
      Object.keys(versions).length > MAX_CHANGED) {
    return NextResponse.json({ error: 'INVALID_REORDER' }, { status: 400 })
  }
  const expected = versions as Record<string, unknown>
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Also serializes modifications with original per-entity PATCH and subtree DELETE.
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR NO KEY UPDATE', [workspaceId])
    const result = await client.query<Row>(
      `SELECT id,local_id,title,content,version FROM entities WHERE workspace_id=$1
         AND kind='worldEntry' AND content->>'category'=$2 AND deleted_at IS NULL
         ORDER BY local_id FOR UPDATE`,
      [workspaceId, NOVEL_CATEGORY],
    )
    const rows = result.rows
    const root = rows.find(row => row.id === entryId && row.content.parentId == null)
    const rootLocalId = root ? parseOriginalId(String(root.local_id)) : null
    if (!root || rootLocalId === null) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    }
    const entries = rows.map(row => ({ ...row.content, id: Number(row.local_id), title: row.title } as WorldEntry))
    const plan = planCloudNovelReorder(entries, rootLocalId, dragged, over)
    if (!plan || plan.length > MAX_CHANGED) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'INVALID_REORDER' }, { status: 400 })
    }
    const byLocal = new Map(rows.map(row => [Number(row.local_id), row]))
    const changed = plan.filter(patch => {
      const row = byLocal.get(patch.id)
      return row && (row.content.parentId !== patch.parentId || row.content.order !== patch.order)
    })
    for (const patch of changed) {
      const row = byLocal.get(patch.id)!
      if (expected[String(patch.id)] !== row.version) {
        await client.query('ROLLBACK')
        return NextResponse.json({ error: 'VERSION_CONFLICT', entityId: row.id, actualVersion: row.version }, { status: 409 })
      }
    }
    for (const patch of changed) {
      const row = byLocal.get(patch.id)!
      const nextVersion = row.version + 1
      const nextContent = { ...row.content, parentId: patch.parentId, order: patch.order }
      const snapshot = { title: row.title, data: nextContent }
      await client.query(
        `UPDATE entities SET content=$1::jsonb,version=$2,updated_by=$3,updated_at=now()
         WHERE id=$4 AND workspace_id=$5`,
        [JSON.stringify(nextContent), nextVersion, user.id, row.id, workspaceId],
      )
      await client.query(
        `INSERT INTO entity_revisions(entity_id,version,actor_id,action,summary,content_snapshot)
         VALUES($1,$2,$3,'update','小说章节排序',$4::jsonb)`,
        [row.id, nextVersion, user.id, JSON.stringify(snapshot)],
      )
      await client.query(
        `INSERT INTO change_events(entity_id,version,actor_id,action,changes)
         VALUES($1,$2,$3,'update',$4::jsonb)`,
        [row.id, nextVersion, user.id, JSON.stringify([
          { field: 'parentId', oldValue: row.content.parentId, newValue: patch.parentId },
          { field: 'order', oldValue: row.content.order, newValue: patch.order },
        ])],
      )
    }
    await client.query('COMMIT')
    return NextResponse.json({ updated: changed.length, versions: Object.fromEntries(
      changed.map(patch => [String(patch.id), byLocal.get(patch.id)!.version + 1]),
    ) })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

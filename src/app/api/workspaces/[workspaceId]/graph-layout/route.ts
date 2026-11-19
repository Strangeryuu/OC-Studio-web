import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { pool } from '@/lib/cloud/server/db'
import { GRAPH_LAYOUT_KIND, readGraphLayoutRequest } from '@/lib/cloud/graph-layout'
import type { GraphLayoutResult } from '@/lib/cloud/graph-layout'
import { isCodexEntry } from '@/lib/entry-kinds'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ workspaceId: string }> }
const noStore = { 'Cache-Control': 'private, no-store' }
const failed = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: noStore })

interface StoredNode {
  id: string
  local_id: string | number
  kind: string
  title: string
  version: number
  content: Record<string, unknown>
}
export async function POST(request: Request, context: Context) {
  if (!mutationOriginAllowed(request)) return failed('INVALID_ORIGIN', 403)
  const user = await currentCloudUser()
  if (!user) return failed('UNAUTHORIZED', 401)
  const { workspaceId } = await context.params
  if (!isUuid(workspaceId) || !await authorizedWorkspace(user, workspaceId, 'entity:update'))
    return failed('NOT_FOUND', 404)
  const raw = await request.text()
  if (raw.length > 230_000) return failed('GRAPH_LAYOUT_TOO_LARGE', 413)
  let body: unknown
  try { body = JSON.parse(raw) } catch { return failed('INVALID_GRAPH_LAYOUT', 400) }
  const positions = readGraphLayoutRequest(body)
  if (!positions) return failed('INVALID_GRAPH_LAYOUT', 400)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Keep the same lock order as individual entity PATCH routes. Both readers
    // and writers use the workspace lock before any entity row locks.
    const workspace = await client.query(
      'SELECT id FROM workspaces WHERE id=$1 AND deleted_at IS NULL FOR NO KEY UPDATE',
      [workspaceId],
    )
    if (workspace.rowCount !== 1) {
      await client.query('ROLLBACK')
      return failed('NOT_FOUND', 404)
    }
    const found = await client.query<StoredNode>(
      'SELECT id,local_id,kind,title,content,version FROM entities ' +
      'WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL ' +
      'ORDER BY id FOR UPDATE',
      [workspaceId, positions.map(row => row.id)],
    )
    if (found.rows.length !== positions.length) {
      await client.query('ROLLBACK')
      return failed('GRAPH_NODE_MISSING', 404)
    }
    const byId = new Map(found.rows.map(row => [row.id.toLowerCase(), row]))
    // Validate the complete batch before issuing the first write.
    for (const position of positions) {
      const current = byId.get(position.id.toLowerCase())
      if (!current || current.kind !== GRAPH_LAYOUT_KIND[position.entityType] ||
          Number(current.local_id) !== position.localId ||
          (current.kind === 'worldEntry' &&
            (typeof current.content.category !== 'string' ||
              !isCodexEntry({ category: current.content.category })))) {
        await client.query('ROLLBACK')
        return failed('GRAPH_NODE_MISMATCH', 404)
      }
      if (current.version !== position.expectedVersion) {
        await client.query('ROLLBACK')
        return NextResponse.json({
          error: 'VERSION_CONFLICT',
          entityId: current.id,
          expectedVersion: position.expectedVersion,
          actualVersion: current.version,
        }, { status: 409, headers: noStore })
      }
    }
    const output: GraphLayoutResult = { positions: [] }
    for (const position of positions) {
      const current = byId.get(position.id.toLowerCase())!
      const before = current.content.graphPosition
      const same = typeof before === 'object' && before !== null &&
        !Array.isArray(before) &&
        (before as { x?: unknown }).x === position.x &&
        (before as { y?: unknown }).y === position.y
      if (same) {
        output.positions.push({ id: current.id, version: current.version, x: position.x, y: position.y })
        continue
      }
      const next = { ...current.content, graphPosition: { x: position.x, y: position.y },
        updatedAt: Date.now() }
      const version = current.version + 1
      if (!Number.isSafeInteger(version)) throw new Error('GRAPH_VERSION_OVERFLOW')
      await client.query(
        'UPDATE entities SET content=$1::jsonb,version=$2,updated_by=$3,updated_at=now() ' +
        'WHERE id=$4 AND workspace_id=$5 AND version=$6',
        [JSON.stringify(next), version, user.id, current.id, workspaceId, current.version],
      )
      output.positions.push({ id: current.id, version, x: position.x, y: position.y })
    }
    await client.query('COMMIT')
    return NextResponse.json(output, { headers: noStore })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

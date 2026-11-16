import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { parseOriginalId } from '@/lib/cloud/original-ids'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const PAGE_SIZE = 100

/** Workspace-scoped source data for the future original UI adapter. */
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId } = await context.params
  if (!await authorizedWorkspace(user, workspaceId, 'entity:read')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const cursor = parseOriginalId(new URL(request.url).searchParams.get('after') ?? '0', true)
  if (cursor === null) return NextResponse.json({ error: 'INVALID_CURSOR' }, { status: 400 })
  const result = await pool.query<{
    id: string; local_id: string; kind: string; title: string; content: unknown
    version: number; updated_at: Date; deleted_at: Date | null
  }>(
    `SELECT id,local_id,kind,title,content,version,updated_at,deleted_at FROM entities
     WHERE workspace_id=$1 AND local_id > $2 ORDER BY local_id ASC LIMIT $3`,
    [workspaceId, cursor, PAGE_SIZE + 1],
  )
  const hasMore = result.rows.length > PAGE_SIZE
  const rows = result.rows.slice(0, PAGE_SIZE)
  const entities = rows.map(row => {
    const localId = parseOriginalId(String(row.local_id))
    if (localId === null) throw new Error('Invalid local entity ID')
    return { ...row, local_id: localId }
  })
  return NextResponse.json({ entities, nextCursor: hasMore ? String(entities.at(-1)!.local_id) : null })
}

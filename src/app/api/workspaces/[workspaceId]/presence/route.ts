import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { pool } from '@/lib/cloud/server/db'
import { validPresenceScope, PRESENCE_TTL_SECONDS } from '@/lib/cloud/presence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ workspaceId: string }> }
async function authorize(workspaceId: string, write: boolean) {
  const user = await currentCloudUser()
  if (!user) return { user: null, status: 401 }
  const role = await authorizedWorkspace(user, workspaceId, write ? 'entity:update' : 'workspace:read')
  return { user, status: role ? 200 : 404 }
}
function bad(status: number, code: string) { return NextResponse.json({ error: code }, { status }) }
export async function GET(request: Request, context: Context) {
  const { workspaceId } = await context.params
  if (!isUuid(workspaceId)) return bad(404, 'NOT_FOUND')
  const access = await authorize(workspaceId, false)
  if (access.status !== 200) return bad(access.status, 'NOT_FOUND')
  const scope = new URL(request.url).searchParams.get('scope')
  if (!validPresenceScope(scope)) return bad(400, 'INVALID_SCOPE')
  const result = await pool.query<{ id: string; name: string; touched_at: string }>(
    `SELECT DISTINCT ON (p.user_id) p.user_id AS id,u.name,p.touched_at
     FROM workspace_edit_presence p
     JOIN "user" u ON u.id=p.user_id AND COALESCE(u.banned,false)=false
     WHERE p.workspace_id=$1 AND p.scope=$2 AND
       p.touched_at > now()-($3::integer*interval '1 second')
     ORDER BY p.user_id,p.touched_at DESC`,
    [workspaceId, scope, PRESENCE_TTL_SECONDS])
  return NextResponse.json({ users: result.rows.map(row => ({ id: row.id, name: row.name })) },
    { headers: { 'Cache-Control': 'private, no-store' } })
}
export async function POST(request: Request, context: Context) {
  if (!mutationOriginAllowed(request)) return bad(403, 'INVALID_ORIGIN')
  const { workspaceId } = await context.params
  if (!isUuid(workspaceId)) return bad(404, 'NOT_FOUND')
  const access = await authorize(workspaceId, true)
  if (access.status !== 200 || !access.user) return bad(access.status, 'NOT_FOUND')
  const input: unknown = await request.json().catch(() => null)
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad(400, 'INVALID_INPUT')
  const { tabId, scope } = input as Record<string, unknown>
  if (!isUuid(tabId) || !validPresenceScope(scope)) return bad(400, 'INVALID_INPUT')
  await pool.query(
    `INSERT INTO workspace_edit_presence(workspace_id,tab_id,user_id,scope,touched_at)
     VALUES($1,$2,$3,$4,now())
     ON CONFLICT(workspace_id,tab_id) DO UPDATE SET
       user_id=EXCLUDED.user_id,scope=EXCLUDED.scope,touched_at=now()`,
    [workspaceId, tabId, access.user.id, scope])
  return NextResponse.json({ online: true })
}
export async function DELETE(request: Request, context: Context) {
  if (!mutationOriginAllowed(request)) return bad(403, 'INVALID_ORIGIN')
  const { workspaceId } = await context.params
  if (!isUuid(workspaceId)) return bad(404, 'NOT_FOUND')
  const access = await authorize(workspaceId, false)
  if (access.status !== 200 || !access.user) return bad(access.status, 'NOT_FOUND')
  const input: unknown = await request.json().catch(() => null)
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad(400, 'INVALID_INPUT')
  const { tabId, scope } = input as Record<string, unknown>
  if (!isUuid(tabId) || !validPresenceScope(scope)) return bad(400, 'INVALID_INPUT')
  await pool.query(
    'DELETE FROM workspace_edit_presence WHERE workspace_id=$1 AND user_id=$2 AND tab_id=$3 AND scope=$4',
    [workspaceId, access.user.id, tabId, scope])
  return NextResponse.json({ online: false })
}

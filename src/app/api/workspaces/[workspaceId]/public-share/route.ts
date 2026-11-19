import { NextResponse } from 'next/server'
import { pool } from '@/lib/cloud/server/db'
import { currentCloudUser, isUuid } from '@/lib/cloud/server/authorization'
import { isSiteAdmin } from '@/lib/cloud/site-policy'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { decryptShareToken, encryptShareToken, newShareToken, shareTokenDigest } from '@/lib/cloud/server/public-share'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ workspaceId: string }> }
const noStore = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }
function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: noStore })
}
async function ownerAccess(userId: string, isAdmin: boolean, workspaceId: string): Promise<boolean> {
  if (!isUuid(workspaceId)) return false
  const result = await pool.query<{ owner_id: string }>(
    'SELECT owner_id FROM workspaces WHERE id=$1 AND deleted_at IS NULL', [workspaceId])
  return !!result.rows[0] && (result.rows[0].owner_id === userId || isAdmin)
}

export async function GET(_request: Request, context: Context) {
  const actor = await currentCloudUser()
  if (!actor) return fail(401, 'UNAUTHORIZED')
  const { workspaceId } = await context.params
  if (!await ownerAccess(actor.id, isSiteAdmin(actor.role), workspaceId)) return fail(404, 'NOT_FOUND')
  const result = await pool.query<{ token_ciphertext: string | null; created_at: string }>(
    `SELECT token_ciphertext,created_at FROM workspace_public_shares
     WHERE workspace_id=$1 AND revoked_at IS NULL LIMIT 1`, [workspaceId])
  const share = result.rows[0]
  return NextResponse.json(share?.token_ciphertext
    ? { active: true, path: '/share/' + decryptShareToken(share.token_ciphertext), createdAt: share.created_at }
    : { active: false }, { headers: noStore })
}

export async function POST(request: Request, context: Context) {
  if (!mutationOriginAllowed(request)) return fail(403, 'INVALID_ORIGIN')
  const actor = await currentCloudUser()
  if (!actor) return fail(401, 'UNAUTHORIZED')
  const { workspaceId } = await context.params
  if (!isUuid(workspaceId)) return fail(404, 'NOT_FOUND')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Serialize share issuance/revocation and ownership transfers.
    const result = await client.query<{ owner_id: string }>(
      'SELECT owner_id FROM workspaces WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [workspaceId])
    if (!result.rows[0] ||
      (result.rows[0].owner_id !== actor.id && !isSiteAdmin(actor.role))) {
      await client.query('ROLLBACK')
      return fail(404, 'NOT_FOUND')
    }
    const token = newShareToken()
    await client.query(`INSERT INTO workspace_public_shares
      (workspace_id,token_sha256,token_ciphertext,issued_by)
      VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id) DO UPDATE
      SET token_sha256=EXCLUDED.token_sha256,
          token_ciphertext=EXCLUDED.token_ciphertext,
          issued_by=EXCLUDED.issued_by,
          revoked_at=NULL,updated_at=now()`,
      [workspaceId, shareTokenDigest(token), encryptShareToken(token), actor.id])
    await client.query(`INSERT INTO audit_logs(workspace_id,actor_id,action,target_id)
      VALUES($1,$2,'workspace:public-share:issue',$1::text)`, [workspaceId, actor.id])
    await client.query('COMMIT')
    return NextResponse.json({ active: true, path: '/share/' + token }, { status: 201, headers: noStore })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

export async function DELETE(request: Request, context: Context) {
  if (!mutationOriginAllowed(request)) return fail(403, 'INVALID_ORIGIN')
  const actor = await currentCloudUser()
  if (!actor) return fail(401, 'UNAUTHORIZED')
  const { workspaceId } = await context.params
  if (!isUuid(workspaceId)) return fail(404, 'NOT_FOUND')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{ owner_id: string }>(
      'SELECT owner_id FROM workspaces WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [workspaceId])
    if (!result.rows[0] ||
      (result.rows[0].owner_id !== actor.id && !isSiteAdmin(actor.role))) {
      await client.query('ROLLBACK')
      return fail(404, 'NOT_FOUND')
    }
    await client.query(`UPDATE workspace_public_shares SET revoked_at=now(),
      token_ciphertext=NULL,updated_at=now() WHERE workspace_id=$1 AND revoked_at IS NULL`, [workspaceId])
    await client.query(`INSERT INTO audit_logs(workspace_id,actor_id,action,target_id)
      VALUES($1,$2,'workspace:public-share:revoke',$1::text)`, [workspaceId, actor.id])
    await client.query('COMMIT')
    return NextResponse.json({ active: false }, { headers: noStore })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

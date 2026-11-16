import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { currentCloudUser } from '@/lib/cloud/server/authorization'
import { canAcceptInvitation } from '@/lib/cloud/invitation-policy'
import { pool } from '@/lib/cloud/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!mutationOriginAllowed(request)) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const body: unknown = await request.json().catch(() => null)
  const code = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>).inviteCode : null
  if (typeof code !== 'string' || !/^[0-9a-f]{64}$/.test(code)) {
    return NextResponse.json({ error: 'INVALID_INVITATION' }, { status: 400 })
  }
  const hash = createHash('sha256').update(code).digest()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{
      id: string; workspace_id: string; invitee_email: string; role: string;
      expires_at: Date; accepted_at: Date | null; revoked_at: Date | null;
    }>(
      `SELECT i.* FROM workspace_invitations i
       JOIN workspaces w ON w.id=i.workspace_id
       WHERE i.token_sha256=$1 AND w.deleted_at IS NULL
       FOR UPDATE OF i`,
      [hash],
    )
    const invite = result.rows[0]
    if (!invite || !canAcceptInvitation({
      inviteeEmail: invite.invitee_email,
      actorEmail: user.email,
      expiresAtMs: invite.expires_at.getTime(),
      nowMs: Date.now(),
      accepted: invite.accepted_at !== null,
      revoked: invite.revoked_at !== null,
    })) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'INVALID_INVITATION' }, { status: 400 })
    }
    await client.query(
      'INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [invite.workspace_id, user.id, invite.role],
    )
    await client.query('UPDATE workspace_invitations SET accepted_at=now() WHERE id=$1', [invite.id])
    await client.query(
      `INSERT INTO audit_logs(workspace_id,actor_id,action,target_id)
       VALUES($1,$2,'member:join',$3)`,
      [invite.workspace_id, user.id, user.id],
    )
    await client.query('COMMIT')
    return NextResponse.json({ workspaceId: invite.workspace_id })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

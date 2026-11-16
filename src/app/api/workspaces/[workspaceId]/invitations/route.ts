import { randomBytes, createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { isInviteRole, normalizeInviteEmail } from '@/lib/cloud/invitation-policy'
import { pool } from '@/lib/cloud/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId } = await context.params
  if (!await authorizedWorkspace(user, workspaceId, 'member:invite')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const body: unknown = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }
  const { email: rawEmail, role } = body as Record<string, unknown>
  const email = normalizeInviteEmail(rawEmail)
  if (!email || !isInviteRole(role)) {
    return NextResponse.json({ error: 'INVALID_INVITATION' }, { status: 400 })
  }
  // Closed-registration deployment: invite only accounts created by site admins.
  const target = await pool.query(
    'SELECT id FROM "user" WHERE lower(email)=$1 AND COALESCE(banned,false)=false', [email],
  )
  if (!target.rows[0]) return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 })
  const member = await pool.query(
    'SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
    [workspaceId, target.rows[0].id],
  )
  if (member.rows[0]) return NextResponse.json({ error: 'ALREADY_MEMBER' }, { status: 409 })

  const code = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(code).digest()
  const result = await pool.query<{ id: string; expires_at: string }>(
    `INSERT INTO workspace_invitations
       (workspace_id,invitee_email,invited_by,role,token_sha256,expires_at)
     VALUES($1,$2,$3,$4,$5,now()+interval '7 days')
     RETURNING id,expires_at`,
    [workspaceId, email, user.id, role, tokenHash],
  )
  // Code is returned once to the inviter. Share it through a secure channel.
  return NextResponse.json({
    id: result.rows[0].id,
    inviteCode: code,
    role,
    expiresAt: result.rows[0].expires_at,
  }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}

import { NextResponse } from 'next/server'
import { hashPassword } from 'better-auth/crypto'
import { pool } from '@/lib/cloud/server/db'
import { siteAdminUser } from '@/lib/cloud/server/site-admin'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { isUuid } from '@/lib/cloud/server/authorization'
import { isSiteAdmin, validAccountEmail, validAccountName, validAccountPassword } from '@/lib/cloud/site-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ userId: string }> }
type StoredUser = { id: string; name: string; email: string; role: string | null }

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!mutationOriginAllowed(request)) return jsonError('INVALID_ORIGIN', 403)
  const actor = await siteAdminUser()
  if (!actor) return jsonError('FORBIDDEN', 403)
  const { userId } = await context.params
  if (!isUuid(userId)) return jsonError('INVALID_USER_ID', 400)
  const input: unknown = await request.json().catch(() => null)
  if (!input || typeof input !== 'object' || Array.isArray(input)) return jsonError('INVALID_INPUT', 400)
  const fields = input as Record<string, unknown>
  const keys = Object.keys(fields)
  if (!keys.length || keys.some(key => !['name', 'email', 'password'].includes(key))) {
    return jsonError('INVALID_INPUT', 400)
  }
  const name = fields.name === undefined ? null : fields.name
  const email = fields.email === undefined ? null : fields.email
  const password = fields.password === undefined ? null : fields.password
  if ((name !== null && !validAccountName(name)) ||
    (email !== null && !validAccountEmail(email)) ||
    (password !== null && !validAccountPassword(password))) return jsonError('INVALID_INPUT', 400)
  const normalizedName = typeof name === 'string' ? name.trim() : null
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : null
  const passwordHash = typeof password === 'string' ? await hashPassword(password) : null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query<StoredUser>(
      'SELECT id,name,email,role FROM "user" WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [userId])
    const previous = found.rows[0]
    if (!previous) {
      await client.query('ROLLBACK')
      return jsonError('USER_NOT_FOUND', 404)
    }
    const emailChanged = normalizedEmail !== null && normalizedEmail !== previous.email
    const updated = await client.query<StoredUser>(
      'UPDATE "user" SET name=COALESCE($2,name), email=COALESCE($3,email), ' +
      '"emailVerified"=CASE WHEN $4::boolean THEN false ELSE "emailVerified" END, ' +
      '"updatedAt"=now() WHERE id=$1 RETURNING id,name,email,role',
      [userId, normalizedName, normalizedEmail, emailChanged])
    if (passwordHash) {
      const credential = await client.query(
        'UPDATE account SET password=$2,"updatedAt"=now() ' +
        'WHERE "userId"=$1 AND "providerId"=\'credential\' RETURNING id', [userId, passwordHash])
      if (!credential.rowCount) {
        await client.query('ROLLBACK')
        return jsonError('CREDENTIAL_NOT_FOUND', 409)
      }
    }
    if (emailChanged || passwordHash) {
      await client.query('DELETE FROM session WHERE "userId"=$1', [userId])
    }
    await client.query(
      'INSERT INTO audit_logs(actor_id,action,target_id,details) VALUES($1,$2,$3,$4::jsonb)',
      [actor.id, 'site:user:update', userId, JSON.stringify({
        nameChanged: normalizedName !== null && normalizedName !== previous.name,
        emailChanged, passwordChanged: !!passwordHash,
      })])
    await client.query('COMMIT')
    return NextResponse.json({ user: updated.rows[0], sessionsRevoked: !!(emailChanged || passwordHash) },
      { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return jsonError('EMAIL_ALREADY_USED', 409)
    }
    throw error
  } finally {
    client.release()
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!mutationOriginAllowed(request)) return jsonError('INVALID_ORIGIN', 403)
  const actor = await siteAdminUser()
  if (!actor) return jsonError('FORBIDDEN', 403)
  const { userId } = await context.params
  if (!isUuid(userId)) return jsonError('INVALID_USER_ID', 400)
  if (userId === actor.id) return jsonError('CANNOT_DELETE_SELF', 403)
  const input: unknown = await request.json().catch(() => null)
  const fields = input && typeof input === 'object' && !Array.isArray(input) ?
    input as Record<string, unknown> : {}
  if (typeof fields.confirmEmail !== 'string') return jsonError('CONFIRM_EMAIL_REQUIRED', 400)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query<StoredUser>(
      'SELECT id,name,email,role FROM "user" WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [userId])
    const target = found.rows[0]
    if (!target) {
      await client.query('ROLLBACK')
      return jsonError('USER_NOT_FOUND', 404)
    }
    if (isSiteAdmin(target.role)) {
      await client.query('ROLLBACK')
      return jsonError('DEMOTE_ADMIN_FIRST', 409)
    }
    if (fields.confirmEmail.trim().toLowerCase() !== target.email.toLowerCase()) {
      await client.query('ROLLBACK')
      return jsonError('CONFIRM_EMAIL_MISMATCH', 409)
    }
    const owned = await client.query<{ id: string }>(
      'SELECT id FROM workspaces WHERE owner_id=$1 FOR UPDATE', [userId])
    for (const workspace of owned.rows) {
      // Ownership transfer invalidates any links issued for the former owner.
      await client.query(
        'UPDATE workspace_public_shares SET revoked_at=now(),token_ciphertext=NULL,updated_at=now() ' +
        'WHERE workspace_id=$1 AND revoked_at IS NULL', [workspace.id])
      // Keep the creative work, its memberships, and its revision history.
      // An existing admin membership is replaced by the owner's slot.
      await client.query('DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
        [workspace.id, actor.id])
      const membership = await client.query(
        'UPDATE workspace_members SET user_id=$2 WHERE workspace_id=$1 AND user_id=$3 ' +
        "AND role='owner' RETURNING workspace_id", [workspace.id, actor.id, userId])
      if (membership.rowCount !== 1) {
        await client.query('ROLLBACK')
        return jsonError('WORKSPACE_OWNER_INVALID', 409)
      }
      await client.query('UPDATE workspaces SET owner_id=$2,updated_at=now() WHERE id=$1',
        [workspace.id, actor.id])
    }
    await client.query('DELETE FROM workspace_members WHERE user_id=$1', [userId])
    await client.query('DELETE FROM session WHERE "userId"=$1', [userId])
    await client.query('DELETE FROM account WHERE "userId"=$1', [userId])
    await client.query('UPDATE workspace_invitations SET revoked_at=now() ' +
      'WHERE lower(invitee_email)=lower($1) AND accepted_at IS NULL AND revoked_at IS NULL',
      [target.email])
    // Historical references remain valid through a pseudonymous tombstone.
    await client.query('UPDATE "user" SET name=$2,email=$3,role=\'user\',banned=true,' +
      '"emailVerified"=false,deleted_at=now(),"updatedAt"=now() WHERE id=$1',
      [userId, '已注销用户', 'deleted+' + userId + '@deleted.invalid'])
    await client.query(
      'INSERT INTO audit_logs(actor_id,action,target_id,details) VALUES($1,$2,$3,$4::jsonb)',
      [actor.id, 'site:user:delete', userId, JSON.stringify({ transferredWorkspaces: owned.rows.length })])
    await client.query('COMMIT')
    return NextResponse.json({ deleted: true, transferredWorkspaces: owned.rows.length },
      { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

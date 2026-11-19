import { NextResponse } from 'next/server'
import { auth } from '@/lib/cloud/server/auth'
import { pool } from '@/lib/cloud/server/db'
import { siteAdminUser } from '@/lib/cloud/server/site-admin'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { isUuid } from '@/lib/cloud/server/authorization'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ userId: string }> }
const lastAttempt = new Map<string, number>()
const COOLDOWN_MS = 30_000

export async function POST(request: Request, context: RouteContext) {
  if (!mutationOriginAllowed(request)) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  const actor = await siteAdminUser()
  if (!actor) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  const { userId } = await context.params
  if (!isUuid(userId)) return NextResponse.json({ error: 'INVALID_USER_ID' }, { status: 400 })
  const target = await pool.query<{ email: string; banned: boolean }>(
    'SELECT email,COALESCE(banned,false) AS banned FROM "user" WHERE id=$1 AND deleted_at IS NULL',
    [userId])
  if (!target.rows[0]) return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 })
  if (target.rows[0].banned) return NextResponse.json({ error: 'USER_BANNED' }, { status: 409 })
  const key = actor.id + ':' + userId
  const now = Date.now()
  const recent = lastAttempt.get(key) ?? 0
  if (now - recent < COOLDOWN_MS) return NextResponse.json({ error: 'RATE_LIMITED' },
    { status: 429 })
  lastAttempt.set(key, now)
  try {
    const baseUrl = process.env.BETTER_AUTH_URL
    if (!baseUrl) throw Error('AUTH_URL_MISSING')
    await auth.api.requestPasswordReset({
      body: { email: target.rows[0].email, redirectTo: new URL('/reset-password', baseUrl).toString() },
      headers: request.headers,
    })
    return NextResponse.json({ sent: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[ocstudio/admin-user-reset] failed', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json({ error: 'MAIL_DELIVERY_FAILED' }, { status: 502 })
  }
}

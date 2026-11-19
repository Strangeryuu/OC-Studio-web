import { NextResponse } from 'next/server'
import { siteAdminUser } from '@/lib/cloud/server/site-admin'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { sendMailTest } from '@/lib/cloud/server/mailer'
import { MailTransportError } from '@/lib/cloud/server/smtp-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The authenticated site administrator can only send a test to their OWN account.
// Prevent turning the endpoint into a public or arbitrary-recipient mail relay.
const previousAttempts = new Map<string, number>()
const COOLDOWN_MS = 15_000

function diagnose(error: unknown): { code: string; stage: string; smtpCode?: number } {
  if (error instanceof MailTransportError) {
    return { code: error.code, stage: error.stage, ...(error.smtpCode ? { smtpCode: error.smtpCode } : {}) }
  }
  const message = error instanceof Error ? error.message : ''
  if (message === 'MAIL_ENCRYPTION_SECRET_MISSING' || message === 'MAIL_SECRET_INVALID' ||
    /authenticate data/i.test(message)) {
    return { code: 'MAIL_PASSWORD_DECRYPT_FAILED', stage: 'auth' }
  }
  if (message === 'MAIL_INVALID_ADDRESS') return { code: 'MAIL_INVALID_ADDRESS', stage: 'message' }
  return { code: 'MAIL_DELIVERY_FAILED', stage: 'unknown' }
}

export async function POST(request: Request) {
  if (!mutationOriginAllowed(request)) {
    return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  }
  const user = await siteAdminUser()
  if (!user) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const now = Date.now()
  const previous = previousAttempts.get(user.id) ?? 0
  if (now - previous < COOLDOWN_MS) {
    return NextResponse.json({ error: 'MAIL_TEST_RATE_LIMITED', retryAfter: Math.ceil((COOLDOWN_MS - (now - previous)) / 1000) },
      { status: 429, headers: { 'Cache-Control': 'no-store' } })
  }
  previousAttempts.set(user.id, now)
  try {
    const result = await sendMailTest(user.email)
    return NextResponse.json({ accepted: true, to: user.email, ...result },
      { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const details = diagnose(error)
    console.error('[ocstudio/mail-test]', { ...details, accountId: user.id })
    return NextResponse.json({ error: details.code, stage: details.stage,
      ...(details.smtpCode ? { smtpCode: details.smtpCode } : {}) },
    { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}

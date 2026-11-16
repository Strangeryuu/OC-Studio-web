import { describe, expect, it } from 'vitest'
import { canAcceptInvitation, isInviteRole, normalizeInviteEmail } from '@/lib/cloud/invitation-policy'

describe('cloud invitation policy', () => {
  it('allows inviting admins, editors and viewers but not owners', () => {
    expect(isInviteRole('admin')).toBe(true)
    expect(isInviteRole('editor')).toBe(true)
    expect(isInviteRole('viewer')).toBe(true)
    expect(isInviteRole('owner')).toBe(false)
  })
  it('checks account email, token expiry and one-time usage', () => {
    const i = { inviteeEmail: 'a@example.com', actorEmail: ' A@EXAMPLE.COM ', expiresAtMs: 1000, nowMs: 999, accepted: false, revoked: false }
    expect(canAcceptInvitation(i)).toBe(true)
    expect(canAcceptInvitation({ ...i, actorEmail: 'b@example.com' })).toBe(false)
    expect(canAcceptInvitation({ ...i, nowMs: 1000 })).toBe(false)
    expect(canAcceptInvitation({ ...i, revoked: true })).toBe(false)
    expect(canAcceptInvitation({ ...i, accepted: true })).toBe(false)
    expect(normalizeInviteEmail('x@@x')).toBe(null)
  })
})

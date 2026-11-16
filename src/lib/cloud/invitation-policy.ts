import type { WorkspaceRole } from './permissions'

export type InviteRole = Exclude<WorkspaceRole, 'owner'>
export function normalizeInviteEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length > 2 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email : null
}
export function isInviteRole(value: unknown): value is InviteRole {
  return value === 'admin' || value === 'editor' || value === 'viewer'
}
export function canAcceptInvitation(input: {
  inviteeEmail: string; actorEmail: string; expiresAtMs: number; nowMs: number;
  accepted: boolean; revoked: boolean
}): boolean {
  const expected = normalizeInviteEmail(input.inviteeEmail)
  return expected !== null && expected === normalizeInviteEmail(input.actorEmail) &&
    Number.isFinite(input.expiresAtMs) && input.expiresAtMs > input.nowMs &&
    !input.accepted && !input.revoked
}

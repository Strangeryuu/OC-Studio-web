/** Site-wide role precedence. Persisted Better Auth role is authoritative. */
export function isSiteAdmin(role: string|null|undefined): boolean {
  return (role??'').split(',').map(r=>r.trim()).includes('admin')
}
export function validAccountName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 100
}
export function validAccountEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254
}
export function validAccountPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128
}
export function validNewAccount(name: unknown, email: unknown, password: unknown): boolean {
  return validAccountName(name) && validAccountEmail(email) && validAccountPassword(password)
}
export function validInviteCode(code:unknown):code is string{
  return typeof code==='string'&&/^[a-f0-9]{48}$/i.test(code.trim())
}

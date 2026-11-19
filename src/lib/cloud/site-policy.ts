/** Site-wide role precedence. Persisted Better Auth role is authoritative. */
export function isSiteAdmin(role: string|null|undefined): boolean {
  return (role??'').split(',').map(r=>r.trim()).includes('admin')
}
export function validNewAccount(name:unknown,email:unknown,password:unknown):boolean{
  return typeof name==='string'&&name.trim().length>=2&&name.trim().length<=100&&
    typeof email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=254&&
    typeof password==='string'&&password.length>=12&&password.length<=128
}
export function validInviteCode(code:unknown):code is string{
  return typeof code==='string'&&/^[a-f0-9]{48}$/i.test(code.trim())
}

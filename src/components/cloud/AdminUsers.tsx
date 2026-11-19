'use client'

import { useState, type FormEvent } from 'react'
import { UserRoundPlus, Shield, Ban, CircleCheck } from 'lucide-react'
import { authClient } from '@/lib/cloud/auth-client'

export interface AdminUserRow {
  id: string
  name: string
  email: string
  role: string | null
  banned: boolean | null
}

export function AdminUsers({ initialUsers, selfId }: { initialUsers: AdminUserRow[]; selfId: string }) {
  const [users, setUsers] = useState(initialUsers)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role,setRole]=useState<'user'|'admin'>('user')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await authClient.admin.createUser({
        email: email.trim().toLowerCase(), name: name.trim(),
        password, role,
      })
      if (response.error) throw new Error(response.error.message || '创建用户失败')
      setEmail('')
      setName('')
      setPassword('')
      window.location.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建用户失败')
    } finally { setBusy(false) }
  }

  async function changeRole(user:AdminUserRow,role:'admin'|'user'){
    if(user.id===selfId||busy)return
    if(!window.confirm('确认修改此账号的平台权限？'))return
    setBusy(true);setError(null)
    try{
      const result=await authClient.admin.setRole({userId:user.id,role})
      if(result.error)throw Error(result.error.message??'调整角色失败')
      setUsers(current=>current.map(row=>row.id===user.id?{...row,role}:row))
    }catch(e){setError(e instanceof Error?e.message:'调整角色失败')}
    finally{setBusy(false)}
  }
  async function toggleBan(user: AdminUserRow) {
    if (busy || user.id === selfId || user.role?.split(',').includes('admin')) return
    if (!window.confirm(user.banned ? '确认恢复这个用户的登录权限？' : '确认禁用这个用户，并撤销其现有会话？')) return
    setBusy(true)
    setError(null)
    try {
      const response = user.banned
        ? await authClient.admin.unbanUser({ userId: user.id })
        : await authClient.admin.banUser({ userId: user.id, banReason: '管理员禁用账号' })
      if (response.error) throw new Error(response.error.message || '修改账号状态失败')
      setUsers(current => current.map(row => row.id === user.id ? { ...row, banned: !user.banned } : row))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '修改账号状态失败')
    } finally { setBusy(false) }
  }

  return <div className="flex flex-col gap-7">
    <div>
      <h1 className="flex items-center gap-2 text-2xl font-semibold"><Shield size={22}/>平台用户管理</h1>
      <p className="mt-2 text-sm opacity-70">管理员可访问与编辑全站资料库；普通用户仅访问自己创建或获邀加入的资料库。</p>
      <a href="/admin" className="mt-2 inline-block text-sm underline">返回管理员菜单</a>
    </div>
    {error && <p role="alert" className="rounded-control border border-[var(--oc-line)] p-3 text-sm">{error}</p>}
    <section className="rounded-panel border border-[var(--oc-line)] p-5">
      <h2 className="mb-4 flex items-center gap-2 font-semibold"><UserRoundPlus size={18}/>创建新账号</h2>
      <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">用户名
          <input required maxLength={100} value={name} onChange={e => setName(e.target.value)}
            className="rounded-control border border-[var(--oc-line)] bg-transparent p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">登录邮箱
          <input type="email" autoComplete="off" required value={email} onChange={e => setEmail(e.target.value)}
            className="rounded-control border border-[var(--oc-line)] bg-transparent p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">初始密码（至少 12 位）
          <input type="password" autoComplete="new-password" minLength={12} required
            value={password} onChange={e => setPassword(e.target.value)}
            className="rounded-control border border-[var(--oc-line)] bg-transparent p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">平台权限
          <select className="rounded-control border border-[var(--oc-line)] bg-transparent p-2"
            value={role} onChange={e=>setRole(e.target.value as typeof role)}>
            <option value="user">普通用户</option><option value="admin">管理员</option>
          </select>
        </label>
        <button type="submit" disabled={busy}
          className="self-end rounded-control border border-[var(--oc-line)] p-2 text-sm disabled:opacity-50">
          {busy ? '操作中…' : '创建普通用户'}
        </button>
      </form>
      <p className="mt-3 text-xs opacity-60">默认创建普通用户。新用户登录后可拥有自己的独立世界观，也可以接受项目邀请。</p>
    </section>
    <section className="rounded-panel border border-[var(--oc-line)] p-5">
      <h2 className="mb-4 font-semibold">平台账号</h2>
      <ul className="flex flex-col gap-3">
        {users.map(user => <li key={user.id}
          className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--oc-line)] pb-3 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{user.name}{user.id === selfId ? '（当前账号）' : ''}</p>
            <p className="break-all text-xs opacity-60">{user.email} · {user.role ?? 'user'}</p>
            <p className="mt-1 text-xs opacity-70">{user.banned ? '已禁用' : '正常'}</p>
          </div>
          {user.id!==selfId&&<select aria-label={'修改'+user.name+'的平台权限'}
            value={user.role?.split(',').includes('admin')?'admin':'user'} disabled={busy}
            onChange={e=>void changeRole(user,e.target.value as 'admin'|'user')}
            className="rounded-control border border-[var(--oc-line)] bg-transparent p-2">
            <option value="user">普通用户</option><option value="admin">管理员</option>
          </select>}
          {user.id !== selfId && !user.role?.split(',').includes('admin') && <button
            type="button" onClick={() => void toggleBan(user)} disabled={busy}
            className="inline-flex items-center gap-1 rounded-control border border-[var(--oc-line)] px-3 py-2 text-xs disabled:opacity-50">
            {user.banned ? <CircleCheck size={14}/> : <Ban size={14}/>}
            {user.banned ? '恢复账号' : '禁用账号'}
          </button>}
        </li>)}
      </ul>
    </section>
  </div>
}

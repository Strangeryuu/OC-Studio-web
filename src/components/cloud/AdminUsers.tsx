'use client'

import { useState, type FormEvent } from 'react'
import { UserRoundPlus, Shield, Ban, CircleCheck, Pencil, Trash2, Mail } from 'lucide-react'
import { authClient } from '@/lib/cloud/auth-client'

export interface AdminUserRow {
  id: string
  name: string
  email: string
  role: string | null
  banned: boolean | null
}

const errorText: Record<string, string> = {
  EMAIL_ALREADY_USED: '这个邮箱已被其他账号使用',
  INVALID_INPUT: '请检查用户名、邮箱和密码（密码至少 12 位）',
  INVALID_ORIGIN: '请求来源校验失败，请刷新页面',
  FORBIDDEN: '当前账号没有管理员权限',
  CANNOT_DELETE_SELF: '当前登录的管理员账号不可删除',
  DEMOTE_ADMIN_FIRST: '请先将该账号降为普通用户，再执行删除',
  CONFIRM_EMAIL_MISMATCH: '邮箱已变化，请刷新列表后重新确认',
  USER_NOT_FOUND: '账号不存在或已经注销',
  CREDENTIAL_NOT_FOUND: '未找到密码登录凭据',
  WORKSPACE_OWNER_INVALID: '该账号的资料库所有者记录异常，请先修复数据',
  MAIL_DELIVERY_FAILED: '邮件发送失败，请检查管理员菜单中的邮件配置',
  RATE_LIMITED: '重置邮件操作过于频繁，请稍后再试',
  USER_BANNED: '此账号已被禁用，请先恢复账号',
}
function readableError(error: string | undefined, fallback: string) {
  return error ? (errorText[error] ?? error) : fallback
}

export function AdminUsers({ initialUsers, selfId }: { initialUsers: AdminUserRow[]; selfId: string }) {
  const [users, setUsers] = useState(initialUsers)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [showEditPassword, setShowEditPassword] = useState(false)

  function clearMessages() { setError(null); setNotice(null) }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true); clearMessages()
    try {
      const response = await authClient.admin.createUser({
        email: email.trim().toLowerCase(), name: name.trim(), password, role,
      })
      if (response.error) throw Error(response.error.message || '创建用户失败')
      setEmail(''); setName(''); setPassword('')
      window.location.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建用户失败')
    } finally { setBusy(false) }
  }

  async function changeRole(user: AdminUserRow, nextRole: 'admin' | 'user') {
    if (user.id === selfId || busy) return
    if (!window.confirm('确认修改此账号的平台权限？')) return
    setBusy(true); clearMessages()
    try {
      const result = await authClient.admin.setRole({ userId: user.id, role: nextRole })
      if (result.error) throw Error(result.error.message ?? '调整角色失败')
      setUsers(current => current.map(row => row.id === user.id ? { ...row, role: nextRole } : row))
      setNotice('账号平台权限已更新')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '调整角色失败') }
    finally { setBusy(false) }
  }

  async function toggleBan(user: AdminUserRow) {
    if (busy || user.id === selfId || user.role?.split(',').includes('admin')) return
    if (!window.confirm(user.banned ? '确认恢复这个用户的登录权限？' : '确认禁用这个用户，并撤销其现有会话？')) return
    setBusy(true); clearMessages()
    try {
      const response = user.banned
        ? await authClient.admin.unbanUser({ userId: user.id })
        : await authClient.admin.banUser({ userId: user.id, banReason: '管理员禁用账号' })
      if (response.error) throw Error(response.error.message || '修改账号状态失败')
      setUsers(current => current.map(row => row.id === user.id ? { ...row, banned: !user.banned } : row))
      setNotice(user.banned ? '账号已恢复' : '账号已禁用')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '修改账号状态失败') }
    finally { setBusy(false) }
  }

  function beginEdit(user: AdminUserRow) {
    setEditingId(user.id)
    setEditName(user.name)
    setEditEmail(user.email)
    setEditPassword('')
    setShowEditPassword(false)
    clearMessages()
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const user = users.find(row => row.id === editingId)
    if (!user || busy) return
    setBusy(true); clearMessages()
    try {
      const payload: { name: string; email: string; password?: string } = {
        name: editName.trim(), email: editEmail.trim().toLowerCase(),
      }
      if (editPassword) payload.password = editPassword
      const response = await fetch('/api/admin/users/' + encodeURIComponent(user.id), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result: { error?: string; user?: AdminUserRow; sessionsRevoked?: boolean } = await response.json()
      if (!response.ok || !result.user) throw Error(readableError(result.error, '修改用户信息失败'))
      setUsers(current => current.map(row => row.id === user.id ? { ...row, ...result.user } : row))
      setEditPassword(''); setEditingId(null)
      setNotice(user.id === selfId && result.sessionsRevoked ?
        '用户信息已修改；当前登录会话已失效，请重新登录。' : '用户信息已保存')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '修改用户信息失败') }
    finally { setBusy(false) }
  }

  async function sendReset(user: AdminUserRow) {
    if (busy || user.banned) return
    if (!window.confirm('确定向 ' + user.email + ' 发送密码重置邮件？')) return
    setBusy(true); clearMessages()
    try {
      const response = await fetch('/api/admin/users/' + encodeURIComponent(user.id) + '/reset-password', {
        method: 'POST',
      })
      const result: { error?: string } = await response.json()
      if (!response.ok) throw Error(readableError(result.error, '邮件发送失败'))
      setNotice('已向 ' + user.email + ' 提交密码重置邮件，请检查收件箱和垃圾邮件。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '邮件发送失败') }
    finally { setBusy(false) }
  }

  async function deleteUser(user: AdminUserRow) {
    if (busy || user.id === selfId || user.role?.split(',').includes('admin')) return
    if (!window.confirm('确定删除 ' + user.name + '（' + user.email + '）吗？该账号将注销，其名下资料库转交当前管理员，历史记录将保留。')) return
    const typed = window.prompt('第二次确认：请输入待删除账号的完整邮箱\n' + user.email)
    if (typed === null) return
    if (typed.trim().toLowerCase() !== user.email.toLowerCase()) {
      setError('邮箱确认不一致，已取消删除')
      return
    }
    setBusy(true); clearMessages()
    try {
      const response = await fetch('/api/admin/users/' + encodeURIComponent(user.id), {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail: typed }),
      })
      const result: { error?: string; transferredWorkspaces?: number } = await response.json()
      if (!response.ok) throw Error(readableError(result.error, '删除账号失败'))
      setUsers(current => current.filter(row => row.id !== user.id))
      if (editingId === user.id) setEditingId(null)
      setNotice('账号已注销；已接管 ' + (result.transferredWorkspaces ?? 0) + ' 个资料库，历史记录保留。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '删除账号失败') }
    finally { setBusy(false) }
  }

  return <div className="flex flex-col gap-7">
    <div>
      <h1 className="flex items-center gap-2 text-2xl font-semibold"><Shield size={22}/>平台用户管理</h1>
      <p className="mt-2 text-sm opacity-70">管理员可访问与编辑全站资料库；普通用户仅访问自己创建或获邀加入的资料库。</p>
      <a href="/admin" className="mt-2 inline-block text-sm underline">返回管理员菜单</a>
    </div>
    {error && <p role="alert" className="rounded-control border border-[var(--oc-line)] p-3 text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="rounded-control border border-[var(--oc-line)] p-3 text-sm">{notice}</p>}
    <section className="rounded-panel border border-[var(--oc-line)] p-5">
      <h2 className="mb-4 flex items-center gap-2 font-semibold"><UserRoundPlus size={18}/>创建新账号</h2>
      <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">用户名
          <input required minLength={2} maxLength={100} value={name} onChange={event => setName(event.target.value)}
            className="rounded-control border border-[var(--oc-line)] bg-transparent p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">登录邮箱
          <input type="email" autoComplete="off" required value={email} onChange={event => setEmail(event.target.value)}
            className="rounded-control border border-[var(--oc-line)] bg-transparent p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">初始密码（至少 12 位）
          <input type="password" autoComplete="new-password" minLength={12} maxLength={128} required
            value={password} onChange={event => setPassword(event.target.value)}
            className="rounded-control border border-[var(--oc-line)] bg-transparent p-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">平台权限
          <select className="rounded-control border border-[var(--oc-line)] bg-transparent p-2"
            value={role} onChange={event => setRole(event.target.value as typeof role)}>
            <option value="user">普通用户</option><option value="admin">管理员</option>
          </select>
        </label>
        <button type="submit" disabled={busy}
          className="self-end rounded-control border border-[var(--oc-line)] p-2 text-sm disabled:opacity-50">
          {busy ? '操作中…' : '创建' + (role === 'admin' ? '管理员' : '普通用户')}
        </button>
      </form>
      <p className="mt-3 text-xs opacity-60">默认创建普通用户。新用户登录后可拥有自己的独立世界观，也可以接受项目邀请。</p>
    </section>
    <section className="rounded-panel border border-[var(--oc-line)] p-5">
      <h2 className="mb-4 font-semibold">平台账号</h2>
      <ul className="flex flex-col gap-4">
        {users.map(user => {
          const self = user.id === selfId
          const admin = user.role?.split(',').includes('admin')
          return <li key={user.id} className="border-b border-[var(--oc-line)] pb-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{user.name}{self ? '（当前账号）' : ''}</p>
                <p className="break-all text-xs opacity-60">{user.email} · {user.role ?? 'user'}</p>
                <p className="mt-1 text-xs opacity-70">{user.banned ? '已禁用' : '正常'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!self && <select aria-label={'修改' + user.name + '的平台权限'}
                  value={admin ? 'admin' : 'user'} disabled={busy}
                  onChange={event => void changeRole(user, event.target.value as 'admin' | 'user')}
                  className="rounded-control border border-[var(--oc-line)] bg-transparent p-2">
                  <option value="user">普通用户</option><option value="admin">管理员</option>
                </select>}
                <button type="button" onClick={() => beginEdit(user)} disabled={busy}
                  className="inline-flex items-center gap-1 rounded-control border border-[var(--oc-line)] px-3 py-2 text-xs disabled:opacity-50">
                  <Pencil size={14}/>编辑信息
                </button>
                <button type="button" onClick={() => void sendReset(user)} disabled={busy || !!user.banned}
                  className="inline-flex items-center gap-1 rounded-control border border-[var(--oc-line)] px-3 py-2 text-xs disabled:opacity-50">
                  <Mail size={14}/>发送重置密码邮件
                </button>
                {!self && !admin && <button type="button" onClick={() => void toggleBan(user)} disabled={busy}
                  className="inline-flex items-center gap-1 rounded-control border border-[var(--oc-line)] px-3 py-2 text-xs disabled:opacity-50">
                  {user.banned ? <CircleCheck size={14}/> : <Ban size={14}/>}
                  {user.banned ? '恢复账号' : '禁用账号'}
                </button>}
                {!self && <button type="button" onClick={() => void deleteUser(user)} disabled={busy || !!admin}
                  title={admin ? '请先将管理员账号降为普通用户再删除' : '二次确认后注销账号'}
                  className="inline-flex items-center gap-1 rounded-control border border-[var(--oc-line)] px-3 py-2 text-xs disabled:opacity-50">
                  <Trash2 size={14}/>删除用户
                </button>}
              </div>
            </div>
            {editingId === user.id && <form onSubmit={saveEdit}
              className="mt-3 grid gap-3 rounded-control border border-[var(--oc-line)] p-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">用户名
                <input required minLength={2} maxLength={100} value={editName}
                  onChange={event => setEditName(event.target.value)}
                  className="rounded-control border border-[var(--oc-line)] bg-transparent p-2" />
              </label>
              <label className="flex flex-col gap-1">登录邮箱
                <input required type="email" value={editEmail} onChange={event => setEditEmail(event.target.value)}
                  className="rounded-control border border-[var(--oc-line)] bg-transparent p-2" />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">新密码（留空则保持原密码，至少 12 位）
                <input type={showEditPassword ? 'text' : 'password'} minLength={12} maxLength={128}
                  autoComplete="new-password" value={editPassword} onChange={event => setEditPassword(event.target.value)}
                  className="rounded-control border border-[var(--oc-line)] bg-transparent p-2" />
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button type="button" aria-pressed={showEditPassword}
                  onClick={() => setShowEditPassword(visible => !visible)}
                  className="rounded-control border border-[var(--oc-line)] px-3 py-2 text-xs">
                  {showEditPassword ? '隐藏密码' : '显示密码'}
                </button>
                <button type="submit" disabled={busy}
                  className="rounded-control bg-[var(--oc-ink)] px-3 py-2 text-xs text-[var(--oc-paper)] disabled:opacity-50">保存修改</button>
                <button type="button" disabled={busy} onClick={() => setEditingId(null)}
                  className="rounded-control border border-[var(--oc-line)] px-3 py-2 text-xs disabled:opacity-50">取消</button>
              </div>
            </form>}
          </li>
        })}
      </ul>
      <p className="mt-3 text-xs opacity-60">修改密码或邮箱后，目标账号的现有会话将失效。删除账号需二次确认；账号将匿名化、登录凭据清除，资料库移交当前管理员，历史记录保留。</p>
    </section>
  </div>
}

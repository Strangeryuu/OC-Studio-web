'use client'
import { useState, type FormEvent } from 'react'

export function InviteCreateForm({ workspaceId }: { workspaceId: string }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'editor' | 'viewer'>('editor')
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setCode(null)
    try {
      const res = await fetch('/api/workspaces/' + workspaceId + '/invitations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      })
      if (!res.ok) { setError('邀请失败，请确认账号已由管理员创建，且尚未加入该项目'); return }
      const json: { inviteCode: string } = await res.json()
      setCode(json.inviteCode)
    } catch { setError('网络异常，请重试') }
    finally { setBusy(false) }
  }
  return <div className="flex max-w-lg flex-col gap-3">
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="text-sm">邀请账号邮箱
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
          className="mt-1 block w-full rounded-md border border-[var(--oc-line)] bg-transparent p-2" />
      </label>
      <label className="text-sm">协作权限
        <select value={role} onChange={e => setRole(e.target.value as typeof role)}
          className="mt-1 block w-full rounded-md border border-[var(--oc-line)] bg-[var(--oc-paper)] p-2">
          <option value="admin">管理员</option><option value="editor">编辑者</option><option value="viewer">访客（可评论）</option>
        </select>
      </label>
      <button type="submit" disabled={busy} className="rounded-md border border-[var(--oc-line)] p-2">
        {busy ? '正在创建邀请' : '生成邀请代码'}
      </button>
    </form>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {code && <div className="rounded-md border border-[var(--oc-line)] p-3 text-sm">
      <p className="mb-1">邀请码（仅显示本次，7 天后过期）</p>
      <code className="block break-all select-all">{code}</code>
      <p className="mt-2 text-xs opacity-70">仅发送给指定邮箱的账号，对方登录后前往 /join 输入邀请码。</p>
    </div>}
  </div>
}

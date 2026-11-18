'use client'
import { useState, type FormEvent } from 'react'

export function InviteAcceptForm() {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: code.trim() }),
      })
      if (!response.ok) { setError('邀请码无效、过期或与你的账号邮箱不匹配'); return }
      const result: { workspaceId: string } = await response.json()
      window.location.assign('/studio/' + encodeURIComponent(result.workspaceId))
    } catch {
      setError('网络异常，请稍后重试')
    } finally { setBusy(false) }
  }
  return <form onSubmit={submit} className="flex max-w-lg flex-col gap-3">
    <label className="text-sm" htmlFor="invite-code">输入收到的 64 位邀请码</label>
    <input id="invite-code" required minLength={64} maxLength={64} value={code}
      onChange={e => setCode(e.target.value)}
      className="rounded-control border border-[var(--oc-line)] bg-transparent p-3 font-mono text-xs" />
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <button type="submit" disabled={busy}
      className="rounded-control border border-[var(--oc-line)] p-3 disabled:opacity-50">
      {busy ? '正在验证' : '接受邀请并加入世界观'}
    </button>
  </form>
}

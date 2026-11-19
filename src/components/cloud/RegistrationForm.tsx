'use client'
import { useState, type FormEvent } from 'react'

export function RegistrationForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, confirmPassword, inviteCode: code }),
      })
      const result: { error?: string } = await res.json()
      if (!res.ok) throw Error(
        result.error === 'INVITE_INVALID' ? '邀请码已过期、已使用完或被撤销' :
        result.error === 'EMAIL_ALREADY_USED' ? '邮箱已被注册' :
        result.error === 'PASSWORD_MISMATCH' ? '两次输入的密码不一致' :
        result.error ?? '注册失败',
      )
      window.location.replace('/login?registered=1')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '注册失败')
    } finally {
      setBusy(false)
    }
  }

  return <section className="w-full max-w-sm rounded-panel border border-[var(--oc-line)] p-7">
    <h1 className="mb-2 text-xl font-semibold">使用邀请码注册</h1>
    <p className="mb-5 text-sm opacity-70">普通账号拥有自己的世界观，也可以加入邀请的协作项目。</p>
    <form className="grid gap-3 text-sm" onSubmit={submit}>
      <label>用户名
        <input required minLength={2} maxLength={100} autoComplete="username"
          value={name} onChange={event => setName(event.target.value)}
          className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2" />
      </label>
      <label>邮箱
        <input type="email" required autoComplete="email" value={email}
          onChange={event => setEmail(event.target.value)}
          className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2" />
      </label>
      <label>密码（至少 12 位）
        <input type={showPassword ? 'text' : 'password'} required minLength={12} maxLength={128}
          autoComplete="new-password" value={password}
          onChange={event => setPassword(event.target.value)}
          className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2" />
      </label>
      <label>确认密码
        <input type={showPassword ? 'text' : 'password'} required minLength={12} maxLength={128}
          autoComplete="new-password" value={confirmPassword}
          onChange={event => setConfirmPassword(event.target.value)}
          aria-invalid={mismatch}
          aria-describedby={mismatch ? 'registration-password-error' : undefined}
          className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2" />
      </label>
      <button type="button" aria-pressed={showPassword} onClick={() => setShowPassword(visible => !visible)}
        className="w-fit rounded-control border border-[var(--oc-line)] px-3 py-1.5 text-xs">
        {showPassword ? '隐藏密码' : '显示密码'}
      </button>
      {mismatch && <p id="registration-password-error" role="alert" className="text-danger">两次输入的密码不一致</p>}
      <label>注册码
        <input required minLength={48} maxLength={48} value={code}
          onChange={event => setCode(event.target.value)}
          className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2" />
      </label>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <button disabled={busy || password !== confirmPassword}
        className="rounded-control bg-[var(--oc-ink)] p-2 text-[var(--oc-paper)] disabled:opacity-50">
        {busy ? '注册中…' : '创建账号'}
      </button>
    </form>
    <a href="/login" className="mt-4 block text-sm underline">返回登录</a>
  </section>
}

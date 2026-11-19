'use client'
import { useState, type FormEvent } from 'react'
import { LockKeyhole, LoaderCircle } from 'lucide-react'
import { authClient } from '@/lib/cloud/auth-client'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const { error: authError } = await authClient.signIn.email({ email: email.trim(), password })
      if (authError) setError('邮箱或密码错误，或者该账号已被禁用')
      else window.location.replace('/')
    } catch {
      setError('登录服务暂时不可用，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return <section className="w-full max-w-sm rounded-panel border border-[var(--oc-line)] bg-[var(--oc-paper)] p-8">
    <div className="mb-7 flex flex-col items-center gap-2 text-center">
      <LockKeyhole size={30} aria-hidden="true" />
      <h1 className="text-xl font-semibold">OC Studio</h1>
      <p className="text-sm opacity-70">登录后访问你的私人创作空间</p>
    </div>
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">邮箱
        <input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}
          className="h-10 rounded-control border border-[var(--oc-line)] bg-transparent px-3" placeholder="you@example.com" />
      </label>
      <label className="flex flex-col gap-1 text-sm">密码
        <input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}
          className="h-10 rounded-control border border-[var(--oc-line)] bg-transparent px-3" />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="flex h-10 items-center justify-center gap-2 rounded-control bg-[var(--oc-ink)] px-4 font-medium text-[var(--oc-paper)] disabled:opacity-50">
        {busy && <LoaderCircle className="animate-spin" size={16} />}
        {busy ? '正在登录' : '登录工作台'}
      </button>
    </form>
    <div className="mt-6 flex justify-center gap-4 text-sm">
      <a className="underline" href="/forgot-password">忘记密码？</a>
      <a className="underline" href="/register">邀请码注册</a>
    </div>
  </section>
}

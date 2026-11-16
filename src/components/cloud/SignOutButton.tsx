'use client'
import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { authClient } from '@/lib/cloud/auth-client'
import { flushPendingSaves } from '@/lib/pending-saves'

export function SignOutButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function leave() {
    if (busy) return
    setBusy(true)
    setError(null)
    const wasInert = document.body.inert
    document.body.inert = true
    try {
      await flushPendingSaves()
      const result = await authClient.signOut()
      if (result.error) throw new Error('退出登录失败')
      window.location.replace('/login')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '退出登录失败')
      setBusy(false)
    } finally {
      document.body.inert = wasInert
    }
  }
  return <span className="flex items-center gap-2">{error && <span role="alert" className="text-caption text-error">{error}</span>}
    <button type="button" onClick={leave} disabled={busy} aria-label="退出登录"
    className="flex items-center gap-2 rounded-control border border-[var(--oc-line)] bg-[var(--oc-paper)] px-3 py-2 text-xs disabled:opacity-50">
    <LogOut size={14} aria-hidden="true" />退出登录
  </button></span>
}

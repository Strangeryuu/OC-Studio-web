'use client'
import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { authClient } from '@/lib/cloud/auth-client'

export function SignOutButton() {
  const [busy, setBusy] = useState(false)
  async function leave() {
    if (busy) return
    setBusy(true)
    try {
      await authClient.signOut()
      window.location.replace('/login')
    } catch {
      setBusy(false)
    }
  }
  return <button type="button" onClick={leave} disabled={busy} aria-label="退出登录"
    className="flex items-center gap-2 rounded-md border border-[var(--oc-line)] bg-[var(--oc-paper)] px-3 py-2 text-xs disabled:opacity-50">
    <LogOut size={14} aria-hidden="true" />退出登录
  </button>
}

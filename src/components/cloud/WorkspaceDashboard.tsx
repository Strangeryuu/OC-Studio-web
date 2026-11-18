'use client'
import { useState, type FormEvent } from 'react'
import { BookOpen, Plus, Users } from 'lucide-react'

export interface WorkspaceListItem {
  id: string
  name: string
  description: string | null
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  updated_at: string
}

export function WorkspaceDashboard({ initialWorkspaces, userName }: {
  initialWorkspaces: WorkspaceListItem[]; userName: string
}) {
  const [workspaces, setWorkspaces] = useState(initialWorkspaces)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) { setError('创建失败，请稍后重试'); return }
      const data: { workspace: WorkspaceListItem } = await res.json()
      setWorkspaces(items => [{ ...data.workspace, updated_at: new Date().toISOString() }, ...items])
      setName('')
    } catch { setError('网络异常，请稍后重试') }
    finally { setBusy(false) }
  }

  return <div className="flex flex-col gap-8">
    <div>
      <h1 className="text-2xl font-semibold">欢迎回来，{userName}</h1>
      <p className="mt-1 text-sm opacity-70">你的私人世界观与协作项目都在这里。</p>
    </div>
    <section className="rounded-panel border border-[var(--oc-line)] p-5">
      <div className="mb-3 flex items-center gap-2"><Plus size={18} /><h2 className="font-medium">创建世界观</h2></div>
      <form onSubmit={create} className="flex flex-wrap gap-2">
        <label htmlFor="new-workspace" className="sr-only">世界观名称</label>
        <input id="new-workspace" value={name} onChange={e => setName(e.target.value)}
          required maxLength={100} placeholder="世界观名称"
          className="min-w-0 flex-1 rounded-control border border-[var(--oc-line)] bg-transparent px-3 py-2" />
        <button disabled={busy} className="rounded-control border border-[var(--oc-line)] px-4 py-2 disabled:opacity-50">
          {busy ? '创建中…' : '创建'}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </section>
    <section>
      <h2 className="mb-4 text-lg font-semibold">我的世界观</h2>
      {workspaces.length === 0
        ? <p className="rounded-panel border border-dashed border-[var(--oc-line)] p-8 text-center text-sm opacity-70">还没有世界观，创建一个或通过邀请码加入项目。</p>
        : <ul className="grid gap-3 sm:grid-cols-2">{workspaces.map(w => <li key={w.id}>
          <a href={'/studio/' + w.id} className="block rounded-panel border border-[var(--oc-line)] p-5 hover:opacity-80">
            <div className="flex items-center gap-2"><BookOpen size={18} /><span className="font-medium">{w.name}</span></div>
            <p className="mt-2 text-sm opacity-70">{w.description || '暂无简介'}</p>
            <p className="mt-4 flex items-center gap-1 text-xs opacity-60"><Users size={13}/>{w.role}</p>
          </a>
        </li>)}</ul>}
    </section>
  </div>
}

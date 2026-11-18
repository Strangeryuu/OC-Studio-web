'use client'

import { useEffect, useState } from 'react'

interface HistoryItem { version: number; action: string; actor_name: string; created_at: string }
const HISTORY_ACTIONS: Record<string, string> = { create: '创建', update: '修改', restore: '恢复', delete: '删除' }

export function WorkspaceEntityHistory({ entityId, version }: { entityId: string; version: number }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<HistoryItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    let active = true
    void fetch(`/api/entities/${entityId}/revisions`, { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('历史记录读取失败')
      const body: { revisions: HistoryItem[] } = await response.json()
      if (!Array.isArray(body.revisions)) throw new Error('历史记录格式错误')
      if (active) { setItems(body.revisions); setError(null) }
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : '历史记录读取失败')
    })
    return () => { active = false }
  }, [entityId, version, open])
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="border-t border-line pt-4">
    <summary className="cursor-pointer text-ui text-ink">修改历史</summary>
    {error ? <p role="alert" className="mt-2 text-ui text-error">{error}</p> : null}
    {open && items === null && !error ? <p className="mt-2 text-caption text-ink-muted">正在读取历史…</p> : null}
    {open && items && <ul className="mt-2 flex flex-col gap-2 text-caption text-ink-muted">
      {items.map(item => <li key={item.version}>版本 {item.version} · {item.actor_name} · {HISTORY_ACTIONS[item.action] ?? item.action} · {new Date(item.created_at).toLocaleString('zh-CN')}</li>)}
      {items.length === 0 && <li>暂无历史记录</li>}
    </ul>}
  </details>
}

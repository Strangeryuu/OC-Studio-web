'use client'

import { useEffect, useRef, useState } from 'react'

type OnlineUser = { id: string; name: string }

/** A tab reports editing activity only while its page is visible.
 * Server responses use authenticated account names and expire after 45 seconds.
 */
export function WorkspacePresence({ workspaceId, scope, editing }: {
  workspaceId: string
  scope: string
  editing: boolean
}) {
  const tabId = useRef<string | null>(null)
  const [users, setUsers] = useState<OnlineUser[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    // Presence is meaningful only in the mounted workbench. This also keeps
    // isolated editor previews and unit tests from dispatching live requests.
    if (!window.location.pathname.startsWith('/studio/')) return
    let stopped = false
    if (!tabId.current) tabId.current = crypto.randomUUID()
    const id = tabId.current
    const endpoint = '/api/workspaces/' + workspaceId + '/presence'
    const payload = JSON.stringify({ tabId: id, scope })
    const headers = { 'Content-Type': 'application/json' }

    async function poll() {
      try {
        const response = await fetch(endpoint + '?scope=' + encodeURIComponent(scope), { cache: 'no-store' })
        if (!response.ok) throw new Error('状态读取失败')
        const data: { users?: OnlineUser[] } = await response.json()
        if (!stopped) {
          setUsers(Array.isArray(data.users) ? data.users : [])
          setError(false)
        }
      } catch { if (!stopped) setError(true) }
    }
    async function heartbeat() {
      if (!editing || document.visibilityState === 'hidden') return
      try {
        const response = await fetch(endpoint, { method: 'POST', headers, body: payload })
        if (response.ok && !stopped) void poll()
      } catch { /* Missed heartbeats expire on the server. */ }
    }
    function leave() {
      if (!editing) return
      void fetch(endpoint, { method: 'DELETE', headers, body: payload, keepalive: true })
        .catch(() => undefined)
    }
    function visibility() {
      if (document.visibilityState === 'hidden') leave()
      else { void heartbeat(); void poll() }
    }
    void heartbeat()
    void poll()
    const beatTimer = window.setInterval(() => { void heartbeat() }, 15_000)
    const pollTimer = window.setInterval(() => { void poll() }, 12_000)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      stopped = true
      window.clearInterval(beatTimer)
      window.clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', visibility)
      leave()
    }
  }, [workspaceId, scope, editing])

  return <div aria-live="polite" className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-line/60 py-1 text-caption text-ink-muted">
    <span>当前在线：</span>
    {error ? <span>暂时无法读取状态</span> : users.length ? <>
      <span>{users.length} 人</span>
      {users.map(user => <span key={user.id}
        className="rounded-full bg-paper-alt px-2 py-0.5"
        title="正在当前页面编辑">{user.name || '未命名用户'}</span>)}
    </> : <span>暂无正在此页面编辑的成员</span>}
  </div>
}

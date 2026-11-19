'use client'

import { useEffect, useState } from 'react'
import { Copy, ExternalLink, Link2, Link2Off, RefreshCcw } from 'lucide-react'

interface ShareStatus { active: boolean; path?: string; error?: string }
export function WorkspacePublicShare({ workspaceId }: { workspaceId: string }) {
  const [status, setStatus] = useState<ShareStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const endpoint = '/api/workspaces/' + workspaceId + '/public-share'
  useEffect(() => {
    let alive = true
    void fetch(endpoint, { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw Error('分享状态读取失败')
      return response.json() as Promise<ShareStatus>
    }).then(result => { if (alive) setStatus(result) })
      .catch(() => { if (alive) setError('分享状态读取失败，请刷新页面') })
    return () => { alive = false }
  }, [endpoint])
  const fullUrl = status?.path && typeof window !== 'undefined'
    ? window.location.origin + status.path : ''

  async function mutate(method: 'POST' | 'DELETE') {
    if (busy) return
    if (method === 'DELETE' && !window.confirm('确定取消公开分享？旧链接将立即失效，访客将无法再次查看该世界观。')) return
    if (method === 'POST' && status?.active &&
      !window.confirm('确定重新生成分享链接？之前发出的全部旧链接将立即失效。')) return
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(endpoint, { method })
      const result: ShareStatus = await response.json()
      if (!response.ok) throw Error(result.error === 'NOT_FOUND' ?
        '只有世界观所有者或站点管理员可以分享此世界观' : '分享操作失败，请稍后重试')
      setStatus(result)
      setMessage(method === 'DELETE' ? '分享已取消；原链接已失效' :
        '分享链接已生成，朋友无需注册即可只读查看')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '分享操作失败')
    } finally { setBusy(false) }
  }

  async function copy() {
    if (!fullUrl) return
    try {
      await navigator.clipboard.writeText(fullUrl)
      setMessage('分享链接已复制')
      setError('')
    } catch {
      setError('浏览器未允许自动复制，请手动选择下方链接复制')
    }
  }

  return <section className="rounded-panel border border-line p-5">
    <h2 className="mb-2 flex items-center gap-2 text-reading font-medium"><Link2 size={17}/>游客查看分享</h2>
    <p className="mb-4 text-sm text-ink-muted">世界观所有者和站点管理员可以创建、替换或取消访客链接。
      拥有链接的朋友无需注册即可阅读世界观内容与图片。访客只有查看权限。</p>
    {!status && !error && <p className="text-sm opacity-70">正在读取分享状态…</p>}
    {status?.active && <div className="mb-3 flex flex-col gap-2">
      <label className="text-xs text-ink-muted" htmlFor="workspace-public-share-url">当前分享链接</label>
      <input id="workspace-public-share-url" value={fullUrl} readOnly onFocus={event => event.target.select()}
        className="w-full rounded-control border border-line bg-transparent px-3 py-2 text-sm" />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void copy()}
          className="inline-flex items-center gap-1 rounded-control border border-line px-3 py-2 text-sm disabled:opacity-50">
          <Copy size={14}/>复制链接</button>
        <a href={status.path} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-control border border-line px-3 py-2 text-sm">
          <ExternalLink size={14}/>打开访客页</a>
      </div>
    </div>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy || !status} onClick={() => void mutate('POST')}
        className="inline-flex items-center gap-1 rounded-control border border-line px-3 py-2 text-sm disabled:opacity-50">
        {status?.active ? <RefreshCcw size={14}/> : <Link2 size={14}/>}
        {status?.active ? '重新生成链接' : '创建分享链接'}
      </button>
      {status?.active && <button type="button" disabled={busy} onClick={() => void mutate('DELETE')}
        className="inline-flex items-center gap-1 rounded-control border border-line px-3 py-2 text-sm text-danger disabled:opacity-50">
        <Link2Off size={14}/>取消分享
      </button>}
    </div>
    {status && !status.active && <p className="mt-3 text-xs text-ink-muted">当前未公开分享，原有链接已失效。</p>}
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </section>
}

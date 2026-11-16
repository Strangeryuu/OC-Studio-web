'use client'
import { useState, type FormEvent } from 'react'
import { Plus, Tag, X } from 'lucide-react'
import type { CloudWorkspaceTag } from '@/lib/cloud/shared-tags'
import type { WorkspaceRole } from '@/lib/cloud/permissions'

const DEFAULT_COLORS = ['#4ecdc4', '#45b7d1', '#ff6b6b', '#96ceb4', '#dda0dd', '#f7dc6f', '#bb8fce', '#85c1e9']

export function CloudWorkspaceTags({
  workspaceId, role, initialTags, selectedIds, legacyLabels, onChange, onLegacyChange,
}: {
  workspaceId: string
  role: WorkspaceRole
  initialTags: CloudWorkspaceTag[]
  selectedIds: string[]
  legacyLabels: string[]
  onChange: (ids: string[]) => void
  onLegacyChange: (labels: string[]) => void
}) {
  const editable = role === 'owner' || role === 'admin' || role === 'editor'
  const [tags, setTags] = useState(initialTags)
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLORS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editable || busy || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/workspaces/' + workspaceId + '/tags', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color }),
      })
      if (response.status === 409) { setError('已有同名标签，请从上方选择。'); return }
      if (!response.ok) throw new Error('创建标签失败')
      const result: { tag: CloudWorkspaceTag } = await response.json()
      setTags(current => [...current, result.tag].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')))
      if (selectedIds.length < 30) onChange([...selectedIds, result.tag.id])
      setName('')
    } catch { setError('创建标签失败，请重试') }
    finally { setBusy(false) }
  }

  async function renameDirect(tag: CloudWorkspaceTag) {
    const next = window.prompt('新的共享标签名称', tag.name)?.trim()
    if (!next || next === tag.name || next.length > 40) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/workspaces/' + workspaceId + '/tags/' + tag.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next, color: tag.color }),
      })
      if (!response.ok) throw new Error('更新失败')
      const result: { tag: CloudWorkspaceTag } = await response.json()
      setTags(current => current.map(t => t.id === tag.id ? result.tag : t))
    } catch { setError('修改失败，可能存在重名标签') }
    finally { setBusy(false) }
  }

  return <section className="rounded-lg border border-[var(--oc-line)] p-5">
    <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><Tag size={18}/>世界观共用标签</h2>
    <p className="mb-4 text-xs opacity-70">角色引用当前世界观的共享标签。同一标签改名后，所有角色会同步显示新名字。</p>
    {error && <p role="alert" className="mb-3 text-sm">{error}</p>}
    <div className="flex flex-wrap gap-2">
      {selectedIds.map(id => {
        const tag = tags.find(t => t.id === id)
        return <span key={id} className="inline-flex items-center gap-2 rounded-full border border-[var(--oc-line)] px-3 py-1 text-sm">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag?.color ?? '#64748b' }}/>
          {tag?.name ?? '已失效的标签'}
          {editable && <button type="button" aria-label={'取消标签 ' + (tag?.name ?? id)}
            onClick={() => onChange(selectedIds.filter(value => value !== id))}><X size={14}/></button>}
        </span>
      })}
      {selectedIds.length === 0 && <p className="text-sm opacity-60">暂无共享标签</p>}
    </div>
    {editable && <div className="mt-4 flex flex-wrap gap-2">
      <label className="sr-only" htmlFor="cloud-tag-picker">选择世界观标签</label>
      <select id="cloud-tag-picker" defaultValue="" disabled={selectedIds.length >= 30}
        className="min-w-0 flex-1 rounded-md border border-[var(--oc-line)] bg-[var(--oc-paper)] px-3 py-2 text-sm"
        onChange={event => {
          const id = event.target.value
          if (id && !selectedIds.includes(id) && selectedIds.length < 30) onChange([...selectedIds, id])
          event.target.value = ''
        }}>
        <option value="">选择已有标签…</option>
        {tags.filter(t => !selectedIds.includes(t.id)).map(tag =>
          <option value={tag.id} key={tag.id}>{tag.name}</option>)}
      </select>
    </div>}
    {editable && <form onSubmit={create} className="mt-4 flex flex-wrap items-center gap-2">
      <input aria-label="新建标签名称" value={name} maxLength={40} onChange={event => setName(event.target.value)}
        placeholder="新建共享标签" className="min-w-0 flex-1 rounded border border-[var(--oc-line)] bg-transparent px-3 py-2 text-sm" />
      <label className="sr-only" htmlFor="cloud-tag-color">标签颜色</label>
      <select id="cloud-tag-color" value={color} onChange={event => setColor(event.target.value)}
        className="rounded border border-[var(--oc-line)] bg-[var(--oc-paper)] p-2 text-sm">
        {DEFAULT_COLORS.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <button type="submit" disabled={busy} className="inline-flex items-center gap-1 rounded border border-[var(--oc-line)] px-3 py-2 text-sm disabled:opacity-50"><Plus size={14}/>创建</button>
    </form>}
    {editable && tags.length > 0 && <div className="mt-3 text-xs">
      <p className="mb-2 opacity-70">编辑共享标签名称：</p>
      <div className="flex flex-wrap gap-2">{tags.map(tag => <button key={tag.id} type="button"
        disabled={busy} onClick={() => void renameDirect(tag)}
        className="rounded border border-[var(--oc-line)] px-2 py-1">{tag.name}</button>)}</div>
    </div>}
    {legacyLabels.length > 0 && <div className="mt-5 border-t border-[var(--oc-line)] pt-4">
      <p className="mb-2 text-xs opacity-70">历史文字标签（继续保留，可手动建立对应的共享标签）</p>
      <div className="flex flex-wrap gap-2">{legacyLabels.map(label =>
        <span key={label} className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--oc-line)] px-2 py-1 text-xs">
          {label}{editable && <button type="button" aria-label={'移除旧标签 '+label}
            onClick={() => onLegacyChange(legacyLabels.filter(x => x !== label))}><X size={12}/></button>}
        </span>)}</div>
    </div>}
  </section>

}

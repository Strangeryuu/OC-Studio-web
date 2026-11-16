'use client'
import { useState, type FormEvent } from 'react'
import { BookOpen, Plus, UserRound } from 'lucide-react'
import type { CloudEntityListItem } from '@/lib/cloud/client-types'
import type { WorkspaceRole } from '@/lib/cloud/permissions'

const KIND_LABEL: Record<string,string> = {
  character: '角色', event: '事件', country: '国家', worldEntry: '词条',
  novelChapter: '小说章节', period: '时期', tag: '标签',
}

export function WorkspaceCharacters({ workspaceId, role, initialEntities }: {
  workspaceId: string; role: WorkspaceRole; initialEntities: CloudEntityListItem[]
}) {
  const [entities, setEntities] = useState(initialEntities)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canCreate = role === 'owner' || role === 'admin' || role === 'editor'

  async function createCharacter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !canCreate || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/workspaces/' + workspaceId + '/entities', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'character', title: name.trim(),
          data: {
            name: name.trim(), aliases: [], race: '', occupation: '', faction: '',
            bio: '', document: { type: 'doc', content: [{ type: 'paragraph' }] },
          },
        }),
      })
      if (!response.ok) throw new Error('创建角色失败（HTTP ' + response.status + '）')
      const body: { entity: { id: string; version: number; kind: string; title: string } } = await response.json()
      setEntities(previous => [{
        id: body.entity.id, version: body.entity.version,
        kind: body.entity.kind, title: body.entity.title, updated_at: new Date().toISOString(),
      }, ...previous])
      setName('')
      window.location.assign('/workspaces/' + workspaceId + '/entities/' + body.entity.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建失败')
    } finally { setBusy(false) }
  }

  return <section className="rounded-lg border border-[var(--oc-line)] p-5">
    <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><BookOpen size={18}/>创作资料</h2>
    {canCreate && <form onSubmit={createCharacter} className="mb-5 flex flex-wrap gap-2">
      <label htmlFor="cloud-character-name" className="sr-only">新角色名称</label>
      <input id="cloud-character-name" value={name} onChange={e => setName(e.target.value)}
        maxLength={200} required placeholder="输入新角色的名字"
        className="min-w-0 flex-1 rounded-md border border-[var(--oc-line)] bg-transparent px-3 py-2 text-sm" />
      <button type="submit" disabled={busy}
        className="inline-flex items-center gap-2 rounded-md border border-[var(--oc-line)] px-4 py-2 text-sm disabled:opacity-50">
        <Plus size={15}/>{busy ? '创建中…' : '新建角色'}
      </button>
    </form>}
    {error && <p role="alert" className="mb-4 text-sm">{error}</p>}
    <ul className="grid gap-2 sm:grid-cols-2">
      {entities.map(entity => <li key={entity.id}>
        {entity.kind === 'character'
          ? <a href={'/workspaces/' + workspaceId + '/entities/' + entity.id}
              className="flex items-center gap-3 rounded-md border border-[var(--oc-line)] p-3 hover:opacity-80">
              <UserRound size={20} aria-hidden="true"/>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{entity.title}</p>
                <p className="text-xs opacity-60">角色 · V{entity.version}</p>
              </div>
            </a>
          : <div className="rounded-md border border-[var(--oc-line)] p-3 text-sm">
              <p className="font-medium">{entity.title}</p>
              <p className="text-xs opacity-60">{KIND_LABEL[entity.kind] || entity.kind} · 详情编辑器待迁移</p>
            </div>}
      </li>)}
    </ul>
    {entities.length === 0 && <p className="rounded-md border border-dashed border-[var(--oc-line)] p-6 text-center text-sm opacity-70">
      还没有角色与创作条目。{canCreate ? '可以从上方创建第一个角色。' : '等待项目编辑者添加内容。'}
    </p>}
    <p className="mt-4 text-xs opacity-60">云端角色编辑已接入 PostgreSQL，支持自动保存、历史版本、图片与项目成员权限；人物关系及共用标签已有云端基础功能，原版高级图谱编辑和完整模板继续迁移中。</p>
  </section>
}

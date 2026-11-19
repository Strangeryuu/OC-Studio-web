'use client'

import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Save, Trash2 } from 'lucide-react'
import { DashboardView, type DashboardData, type DashboardProps } from '@/features/dashboard/components/Dashboard'
import { useWorkspaceDraftGuard, useWorkspaceImageUpload } from '@/components/cloud/workspace-editor-guards'
import { registerPendingSave } from '@/lib/pending-saves'
import { BTN_QUIET } from '@/lib/ui-tokens'

export interface WorkspaceHomeProps extends DashboardProps, Omit<DashboardData, 'coverUrl'> {
  workspaceId: string
  canUpdate: boolean
}

export function WorkspaceHome({ workspaceId, canUpdate, ...dashboard }: WorkspaceHomeProps) {
  const [coverUrl, setCoverUrl] = useState('')
  const [draft, setDraft] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const writing = useRef<Promise<void> | null>(null)
  const upload = useWorkspaceImageUpload(workspaceId, canUpdate && !saving, setUploading, setError)

  useEffect(() => {
    let alive = true
    void fetch('/api/workspaces/' + workspaceId + '/cover', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('世界封面加载失败')
        return response.json() as Promise<{ coverUrl: string; version: number }>
      })
      .then(data => {
        if (!alive) return
        setCoverUrl(data.coverUrl)
        setVersion(data.version)
      }).catch(cause => {
        if (alive) setError(cause instanceof Error ? cause.message : '世界封面加载失败')
      })
    return () => { alive = false }
  }, [workspaceId])

  useEffect(() => registerPendingSave(() => {
    if (writing.current) return writing.current
    if (draft !== null) throw new Error('世界封面有未保存修改，请先重试或放弃')
  }), [draft])
  useWorkspaceDraftGuard(draft !== null || uploading || saving, '世界封面')

  async function save(url: string) {
    if (saving || uploading || !canUpdate) return
    setDraft(url)
    setSaving(true)
    setError(null)
    const task = (async () => {
      const response = await fetch('/api/workspaces/' + workspaceId + '/cover', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: version, coverUrl: url }),
      })
      const result: { error?: string; version?: number; coverUrl?: string } =
        await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error === 'VERSION_CONFLICT'
        ? '封面已由另一位成员更改，请保留当前图片后刷新页面'
        : '封面保存失败：' + (result.error ?? response.status))
      if (typeof result.version !== 'number') throw new Error('封面保存结果无效')
      setCoverUrl(url)
      setVersion(result.version)
      setDraft(null)
    })()
    writing.current = task
    try { await task } catch (cause) {
      setError(cause instanceof Error ? cause.message : '世界封面保存失败')
    } finally { writing.current = null; setSaving(false) }
  }
  async function choose(file?: File) {
    if (!file || !canUpdate) return
    const url = await upload(file, file.name)
    if (url) await save(url)
  }

  return <section className="min-w-0">
    {canUpdate && <div className="flex flex-wrap items-center justify-end gap-2 border-b border-line py-1">
      <label className={BTN_QUIET + ' cursor-pointer'}>
        <ImagePlus size={14}/>上传世界封面
        <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
          disabled={uploading || saving} aria-label="上传世界封面"
          onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''
            void choose(file)
          }} />
      </label>
      {(coverUrl || draft) && <button type="button" className={BTN_QUIET}
        disabled={saving || uploading} onClick={() => {
          if (window.confirm('确认移除世界观封面？其他词条的同一图片仍保留。')) void save('')
        }}>
        <Trash2 size={14}/>移除封面
      </button>}
      {draft !== null && <button type="button" className={BTN_QUIET}
        disabled={saving || uploading} onClick={() => void save(draft)}>
        <Save size={14}/>重试保存
      </button>}
      {(uploading || saving) && <span className="text-caption text-ink-faint">正在同步封面…</span>}
    </div>}
    {error && <p role="alert" className="px-3 py-2 text-ui text-error">{error}</p>}
    <DashboardView {...dashboard} coverUrl={draft ?? coverUrl} showCreate={dashboard.showCreate} />
  </section>
}

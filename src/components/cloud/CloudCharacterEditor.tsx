'use client'

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import { ArrowLeft, Check, CloudUpload, History, ImagePlus, RefreshCw } from 'lucide-react'
import { cloudCharacterFields, mergeCloudCharacter, type CloudCharacterFields } from '@/lib/cloud/character-document'
import type { CloudEntityRow, CloudRevision } from '@/lib/cloud/client-types'
import type { WorkspaceRole } from '@/lib/cloud/permissions'
import { CloudSnapshotBody } from '@/components/cloud/CloudSnapshotBody'

const FIELD_ITEMS: { key: keyof CloudCharacterFields; label: string }[] = [
  { key: 'name', label: '姓名' }, { key: 'race', label: '种族' },
  { key: 'occupation', label: '职业' }, { key: 'faction', label: '阵营' },
  { key: 'element', label: '元素' }, { key: 'height', label: '身高' },
  { key: 'birthday', label: '生日' },
]

export function CloudCharacterEditor({ workspaceId, role, initial }: {
  workspaceId: string
  role: WorkspaceRole
  initial: CloudEntityRow
}) {
  const editable = role === 'owner' || role === 'admin' || role === 'editor'
  const canRestore = role === 'owner' || role === 'admin'
  const [fields, setFields] = useState<CloudCharacterFields>(() => cloudCharacterFields(initial.content, initial.title))
  const fieldsRef = useRef(fields)
  const [version, setVersion] = useState(initial.version)
  const versionRef = useRef(initial.version)
  const originalRef = useRef<Record<string, unknown>>(initial.content)
  const draftSeq = useRef(0)
  const sending = useRef(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [revisions, setRevisions] = useState<CloudRevision[]>([])
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null)
  const [revisionDoc, setRevisionDoc] = useState<{ title: string; data: Record<string, unknown> } | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)

  const updateFields = useCallback((change: Partial<CloudCharacterFields>) => {
    if (!editable) return
    const next = { ...fieldsRef.current, ...change }
    fieldsRef.current = next
    setFields(next)
    draftSeq.current += 1
    setDirty(true)
  }, [editable])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({ placeholder: '在这里编写角色经历、背景故事和详细设定…' }),
    ],
    content: fields.document,
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'min-h-64 max-w-none outline-none px-4 py-3 text-sm leading-7 [&_h2]:text-lg [&_h2]:font-semibold [&_p]:my-2',
      },
    },
    onUpdate: ({ editor: activeEditor }) => updateFields({ document: activeEditor.getJSON() }),
  }, [initial.id])

  useEffect(() => { editor?.setEditable(editable) }, [editor, editable])

  const save = useCallback(async () => {
    if (!editable || sending.current || conflict) return
    sending.current = true
    setSaving(true)
    setError(null)
    const seq = draftSeq.current
    const next = { ...fieldsRef.current, document: editor?.getJSON() ?? fieldsRef.current.document }
    const data = mergeCloudCharacter(originalRef.current, next)
    try {
      const response = await fetch('/api/entities/' + initial.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next.name.trim(), data, expectedVersion: versionRef.current }),
      })
      if (response.status === 409) {
        setConflict(true)
        setError('其他协作者已更新此角色。请先复制当前草稿，再加载服务器最新版本进行合并。')
        return
      }
      if (!response.ok) throw new Error('服务器保存失败（HTTP ' + response.status + '）')
      const result: { version: number } = await response.json()
      originalRef.current = data
      versionRef.current = result.version
      setVersion(result.version)
      setDirty(draftSeq.current !== seq)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      sending.current = false
      setSaving(false)
    }
  }, [editable, conflict, editor, initial.id])

  useEffect(() => {
    if (!dirty || !editable || conflict || saving) return
    const timer = window.setTimeout(() => { void save() }, 1800)
    return () => window.clearTimeout(timer)
  }, [fields, dirty, editable, conflict, saving, save])

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty || saving) event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, saving])

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !editable) return
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      const response = await fetch('/api/workspaces/' + workspaceId + '/media', { method: 'POST', body: form })
      if (!response.ok) throw new Error('图片上传失败（HTTP ' + response.status + '）')
      const body: { asset: { id: string } } = await response.json()
      updateFields({ avatarMediaId: body.asset.id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图片上传失败')
    } finally { setUploading(false) }
  }

  const loadHistory = useCallback(async () => {
    setHistoryBusy(true)
    try {
      const response = await fetch('/api/entities/' + initial.id + '/revisions', { cache: 'no-store' })
      if (!response.ok) throw new Error('获取历史记录失败')
      const value: { revisions: CloudRevision[] } = await response.json()
      setRevisions(value.revisions)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '历史记录获取失败') }
    finally { setHistoryBusy(false) }
  }, [initial.id])

  async function selectRevision(nextVersion: number) {
    setSelectedRevision(nextVersion)
    setRevisionDoc(null)
    const response = await fetch('/api/entities/' + initial.id + '/revisions/' + nextVersion, { cache: 'no-store' })
    if (!response.ok) { setError('读取历史快照失败'); return }
    const result: { revision: { content_snapshot: { title: string; data: Record<string, unknown> } } } = await response.json()
    setRevisionDoc(result.revision.content_snapshot)
  }

  async function restoreRevision() {
    if (!canRestore || selectedRevision === null || dirty || saving) return
    if (!window.confirm('将此历史版本恢复为新版本？目前的版本也会保留在历史记录中。')) return
    setHistoryBusy(true)
    try {
      const response = await fetch('/api/entities/' + initial.id + '/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restoreVersion: selectedRevision, expectedVersion: versionRef.current }),
      })
      if (response.status === 409) { setError('恢复时发生版本冲突，请刷新页面'); return }
      if (!response.ok) throw new Error('恢复失败')
      window.location.reload()
    } catch { setError('恢复历史版本失败，请重试') }
    finally { setHistoryBusy(false) }
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(JSON.stringify({
        title: fieldsRef.current.name,
        data: mergeCloudCharacter(originalRef.current, fieldsRef.current),
      }, null, 2))
      setError('草稿已复制，可在刷新后手动对照合并。')
    } catch { setError('复制失败，请检查浏览器剪贴板权限') }
  }

  const avatarUrl = fields.avatarMediaId ? '/api/media/' + encodeURIComponent(fields.avatarMediaId) : null
  const historyFields = revisionDoc ? cloudCharacterFields(revisionDoc.data, revisionDoc.title) : null
  const compareKeys: (keyof CloudCharacterFields)[] = ['name', 'bio', 'race', 'occupation', 'faction', 'element', 'height', 'birthday', 'aliases']

  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <a className="inline-flex items-center gap-2 text-sm opacity-70" href={'/workspaces/' + workspaceId}><ArrowLeft size={15} />返回世界观</a>
      <div className="flex items-center gap-2 text-sm">
        <span className="opacity-60">版本 {version}</span>
        {editable && <button type="button" onClick={() => void save()} disabled={saving || !dirty || conflict || !fields.name.trim()}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--oc-line)] px-3 py-2 disabled:opacity-50">
          <CloudUpload size={16} />{saving ? '保存中…' : dirty ? '保存修改' : '已保存'}
        </button>}
        <button type="button" onClick={() => { setShowHistory(!showHistory); if (!showHistory) void loadHistory() }}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--oc-line)] px-3 py-2">
          <History size={16} />历史记录
        </button>
      </div>
    </div>
    {error && <p role="status" className="rounded-md border border-[var(--oc-line)] p-3 text-sm">{error}</p>}
    {conflict && <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--oc-line)] p-4 text-sm">
      <span>检测到多人编辑冲突。建议先备份本地草稿再重新载入。</span>
      <button type="button" onClick={() => void copyDraft()} className="underline">复制我的草稿</button>
      <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-1 underline"><RefreshCw size={14}/>加载最新版</button>
    </div>}
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3">
        <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg border border-[var(--oc-line)]">
          {avatarUrl ? <img src={avatarUrl} alt={fields.name + '的立绘'} className="h-full w-full object-cover" /> :
            <ImagePlus className="opacity-40" size={48} aria-hidden="true" />}
        </div>
        {editable && <label className="cursor-pointer rounded-md border border-[var(--oc-line)] p-2 text-center text-sm">
          {uploading ? '上传中…' : '上传头像或立绘'}
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploading}
            className="sr-only" onChange={event => void uploadAvatar(event)} />
        </label>}
        {dirty && <p className="text-xs opacity-65">自动保存将在停止编辑后触发。</p>}
      </aside>
      <div className="flex flex-col gap-6">
        <section className="rounded-lg border border-[var(--oc-line)] p-5">
          <h1 className="mb-4 text-xl font-semibold">角色资料 · {fields.name}</h1>
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELD_ITEMS.map(({ key, label }) => <label key={key} className="flex flex-col gap-1 text-sm">
              {label}
              <input value={String(fields[key] ?? '')} disabled={!editable}
                onChange={event => updateFields({ [key]: event.target.value })}
                className="w-full rounded-md border border-[var(--oc-line)] bg-transparent px-3 py-2 disabled:opacity-65" />
            </label>)}
            <label className="flex flex-col gap-1 text-sm">别名（使用逗号分隔）
              <input value={fields.aliases.join('、')} disabled={!editable}
                onChange={event => updateFields({ aliases: event.target.value.split(/[,，、]/).map(x => x.trim()).filter(Boolean) })}
                className="rounded-md border border-[var(--oc-line)] bg-transparent px-3 py-2 disabled:opacity-65" />
            </label>
          </div>
          <label className="mt-4 flex flex-col gap-1 text-sm">简要介绍
            <textarea rows={3} disabled={!editable} value={fields.bio}
              onChange={event => updateFields({ bio: event.target.value })}
              className="rounded-md border border-[var(--oc-line)] bg-transparent p-3 disabled:opacity-65" />
          </label>
        </section>
        <section className="rounded-lg border border-[var(--oc-line)] p-5">
          <h2 className="mb-4 text-lg font-semibold">背景故事与详细设定</h2>
          {editable && editor && <div className="mb-3 flex flex-wrap gap-2 border-b border-[var(--oc-line)] pb-3">
            {[
              { label: '加粗', active: editor.isActive('bold'), call: () => editor.chain().focus().toggleBold().run() },
              { label: '斜体', active: editor.isActive('italic'), call: () => editor.chain().focus().toggleItalic().run() },
              { label: '标题', active: editor.isActive('heading', { level: 2 }), call: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
              { label: '项目符号', active: editor.isActive('bulletList'), call: () => editor.chain().focus().toggleBulletList().run() },
            ].map(action => <button key={action.label} type="button" onClick={action.call}
              aria-pressed={action.active}
              className="rounded border border-[var(--oc-line)] px-2 py-1 text-xs aria-pressed:font-bold">{action.label}</button>)}
          </div>}
          <div className="rounded-md border border-[var(--oc-line)]">
            <EditorContent editor={editor} />
          </div>
        </section>
      </div>
    </div>
    {showHistory && <section className="rounded-lg border border-[var(--oc-line)] p-5">
      <h2 className="mb-4 text-lg font-semibold">修改历史</h2>
      {historyBusy && <p className="text-sm opacity-70">加载中…</p>}
      <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {revisions.map(revision => <button type="button" key={revision.version}
            onClick={() => void selectRevision(revision.version)}
            aria-pressed={selectedRevision === revision.version}
            className="rounded-md border border-[var(--oc-line)] p-3 text-left text-sm aria-pressed:font-semibold">
            <span>V{revision.version} · {revision.action}</span>
            <span className="mt-1 block text-xs opacity-60">{revision.actor_name} · {new Date(revision.created_at).toLocaleString('zh-CN')}</span>
          </button>)}
          {revisions.length === 0 && !historyBusy && <p className="text-sm opacity-70">暂无历史记录</p>}
        </div>
        <div className="min-w-0">
          {historyFields ? <div className="flex flex-col gap-3">
            <h3 className="font-semibold">版本 V{selectedRevision} 与当前草稿对比</h3>
            <table className="w-full table-fixed text-left text-sm">
              <thead><tr><th className="py-2">字段</th><th className="py-2">旧版本</th><th className="py-2">当前草稿</th></tr></thead>
              <tbody>{compareKeys.map(key => {
                const oldValue = JSON.stringify(historyFields[key])
                const nowValue = JSON.stringify(fields[key])
                return <tr key={key} className="border-t border-[var(--oc-line)]">
                  <td className="break-all py-2">{key}</td>
                  <td className="break-all py-2">{oldValue?.slice(0, 240)}</td>
                  <td className="break-all py-2">{nowValue?.slice(0, 240)}</td>
                </tr>
              })}</tbody>
            </table>
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold">旧版本正文预览</h4>
              <CloudSnapshotBody key={selectedRevision} content={historyFields.document} />
            </div>
            {canRestore && <button type="button" onClick={() => void restoreRevision()}
              disabled={dirty || saving || historyBusy}
              className="inline-flex items-center justify-center gap-2 self-start rounded-md border border-[var(--oc-line)] px-4 py-2 text-sm disabled:opacity-50">
              <Check size={15} />恢复该版本（生成新版本）
            </button>}
            {dirty && <p className="text-xs opacity-70">请先保存当前修改，再恢复历史版本。</p>}
          </div> : <p className="text-sm opacity-70">选择一个历史版本查看字段变化和恢复选项。</p>}
        </div>
      </div>
    </section>}
  </div>
}

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Providers } from '@/app/providers'
import { SaveStatusProvider, useSaveStatus } from '@/components/layout/SaveStatusContext'
import { Toaster } from '@/components/shared/toaster'
import { SummaryBlock } from '@/components/shared/template-blocks'
import { CharacterInfoSection } from '@/features/characters/components/CharacterInfoSection'
import { characterFormBaseline, useCharacterForm } from '@/features/characters/hooks/useCharacterForm'
import { buildDefaultCharacter } from '@/features/characters/services'
import type { CharacterFormData } from '@/features/characters/types'
import { newCharacterData } from '@/lib/entity-defaults'
import { BUILTIN_FIELDS } from '@/lib/fields'
import { flushPendingSaves } from '@/lib/pending-saves'
import { BTN_PRIMARY, BTN_QUIET, TITLE_INPUT } from '@/lib/ui-tokens'
import { OriginalCharactersCloudAdapter, type OriginalCharacterSnapshot } from '@/lib/cloud/adapters/original-characters'
import type { WorkspaceRole } from '@/lib/cloud/permissions'
import type { Character } from '@/types'

// 国家、关系、图片和模板依赖其他本地库，等它们各自迁移后再开放。
const CLOUD_FIELDS = BUILTIN_FIELDS.character.filter(field => field.id !== 'country')
const EDITABLE_KEYS = [
  'name', 'aliases', 'race', 'element', 'occupation', 'faction',
  'height', 'birthday', 'isMajor', 'bio',
] as const satisfies readonly (keyof CharacterFormData)[]

export function editablePatch(character: Character, values: Partial<CharacterFormData>): Partial<CharacterFormData> {
  const result: Partial<CharacterFormData> = {}
  const baseline = characterFormBaseline(character)
  for (const key of EDITABLE_KEYS) {
    const value = values[key]
    if (value !== undefined && JSON.stringify(value) !== JSON.stringify(baseline[key])) {
      Object.assign(result, { [key]: value })
    }
  }
  return result
}

export function WorkspaceCharacters({ workspaceId, role }: { workspaceId: string; role: WorkspaceRole }) {
  return <Providers><SaveStatusProvider>
    <CharacterWorkspace workspaceId={workspaceId} role={role} />
    <Toaster />
  </SaveStatusProvider></Providers>
}

function CharacterWorkspace({ workspaceId, role }: { workspaceId: string; role: WorkspaceRole }) {
  const adapter = useMemo(() => new OriginalCharactersCloudAdapter(workspaceId), [workspaceId])
  const [rows, setRows] = useState<OriginalCharacterSnapshot[]>([])
  const [selected, setSelected] = useState<OriginalCharacterSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canEdit = role !== 'viewer'

  useEffect(() => {
    let current = true
    void adapter.list().then(result => {
      if (current) setRows(result)
    }).catch(cause => {
      if (current) setError(cause instanceof Error ? cause.message : '角色加载失败')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [adapter])

  const select = useCallback(async (next: OriginalCharacterSnapshot | null) => {
    if (busy || next?.entityId === selected?.entityId) return
    setBusy(true)
    setError(null)
    try {
      // 原版保存流水线会追上保存期间继续输入的内容；失败时保留当前编辑器。
      await flushPendingSaves()
      setSelected(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '当前草稿保存失败')
    } finally { setBusy(false) }
  }, [busy, selected?.entityId])

  async function create() {
    if (busy || !canEdit) return
    setBusy(true)
    setError(null)
    try {
      await flushPendingSaves()
      const next = await adapter.create(buildDefaultCharacter(newCharacterData()))
      setRows(current => [...current, next])
      setSelected(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '角色创建失败')
    } finally { setBusy(false) }
  }

  const saved = useCallback((next: OriginalCharacterSnapshot) => {
    setSelected(next)
    setRows(current => current.map(row => row.entityId === next.entityId ? next : row))
  }, [])

  return <section className="flex flex-col gap-4 border-t border-line pt-5">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-reading font-semibold">角色</h2>
      {canEdit && <button type="button" className={BTN_QUIET} disabled={busy || loading} onClick={() => void create()}>新建角色</button>}
    </div>
    <p className="text-caption text-ink-muted">当前支持角色基本信息与简介；正文、图片和关系正在接入。</p>
    {error && <p role="alert" className="text-ui text-error">{error}</p>}
    {loading ? <p className="text-ui text-ink-muted">正在读取角色…</p> : <div className="flex flex-wrap gap-2">
      {rows.map(row => <button type="button" key={row.entityId} className={BTN_QUIET}
        aria-pressed={selected?.entityId === row.entityId} disabled={busy}
        onClick={() => void select(row)}>{row.character.name}</button>)}
      {rows.length === 0 && <p className="text-ui text-ink-muted">暂无角色</p>}
    </div>}
    {selected && <OriginalCharacterEditor key={selected.entityId} snapshot={selected} adapter={adapter}
      canEdit={canEdit} disabled={busy} onSaved={saved} />}
  </section>
}

function OriginalCharacterEditor({ snapshot, adapter, canEdit, disabled, onSaved }: {
  snapshot: OriginalCharacterSnapshot
  adapter: OriginalCharactersCloudAdapter
  canEdit: boolean
  disabled: boolean
  onSaved: (next: OriginalCharacterSnapshot) => void
}) {
  const baseline = useRef(snapshot)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { status, setActiveEntity } = useSaveStatus()
  const save = useCallback(async (_id: number, values: Partial<CharacterFormData>) => {
    try {
      const next = await adapter.save(baseline.current, editablePatch(baseline.current.character, values))
      baseline.current = next
      setSaveError(null)
      onSaved(next)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : '保存失败')
      throw cause
    }
  }, [adapter, onSaved])
  const form = useCharacterForm(snapshot.character, save, { localLookups: false })

  useEffect(() => {
    setActiveEntity('character')
    return () => setActiveEntity(null)
  }, [setActiveEntity])
  useEffect(() => {
    if (!form.dirty && !form.saving) return
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const guardLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || !(event.target instanceof Element)) return
      const anchor = event.target.closest('a[href]')
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      if (anchor.href === window.location.href || anchor.href.startsWith(`${window.location.href.split('#')[0]}#`)) return
      if (!window.confirm('角色仍有未保存的修改，离开此页面会丢失当前草稿。确定离开吗？')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', handler)
    document.addEventListener('click', guardLink, true)
    return () => {
      window.removeEventListener('beforeunload', handler)
      document.removeEventListener('click', guardLink, true)
    }
  }, [form.dirty, form.saving])

  return <div className="flex flex-col gap-5 rounded-panel border border-line p-5">
    <div className="flex items-center justify-between gap-3">
      <span className="text-caption text-ink-muted">{form.saving ? '保存中…' : form.dirty ? '未保存' : status === 'saved' ? '已保存' : '已同步'}</span>
      {canEdit && <button type="button" className={BTN_PRIMARY} disabled={disabled || form.saving || !form.name.trim()}
        onClick={() => void form.handleSave()}>保存</button>}
    </div>
    {saveError && <div>
      <p role="alert" className="text-ui text-error">{saveError}。当前编辑内容保留在页面中。</p>
      <details className="mt-2 text-ui text-ink-muted">
        <summary>查看并复制当前草稿</summary>
        <textarea readOnly aria-label="当前草稿" className="mt-2 h-48 w-full rounded-control border border-line bg-transparent p-2"
          value={JSON.stringify({ name: form.name, aliases: form.aliasesStr, race: form.race,
            element: form.element, occupation: form.occupation, faction: form.faction,
            height: form.height, birthday: [form.birthdayYear, form.birthdayMonth, form.birthdayDay].join('-'),
            isMajor: form.isMajor, bio: form.bio }, null, 2)} />
      </details>
    </div>}
    <fieldset disabled={!canEdit || disabled} className="flex min-w-0 flex-col gap-6">
      <label className="flex flex-col gap-2 text-ui text-ink-muted">角色名称
        <input value={form.name} onChange={event => form.setName(event.target.value)} className={TITLE_INPUT} />
      </label>
      <CharacterInfoSection form={form} fieldsOverride={CLOUD_FIELDS} />
      <SummaryBlock value={form.bio} onChange={form.setBio} />
    </fieldset>
    <CharacterHistory entityId={snapshot.entityId} version={snapshot.version} />
  </div>
}

interface HistoryItem { version: number; action: string; actor_name: string; created_at: string }
const HISTORY_ACTIONS: Record<string, string> = { create: '创建', update: '修改', restore: '恢复', delete: '删除' }

function CharacterHistory({ entityId, version }: { entityId: string; version: number }) {
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

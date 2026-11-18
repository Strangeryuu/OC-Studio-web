'use client'

/**
 * Original tree-table UI over versioned workspace snapshots.
 * Reuses upstream row projection, tab reorder and inline cell components.
 * All mutations use authenticated workspace adapters; never opens Dexie/vault.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, RotateCw, Search, SearchX, Table2 } from 'lucide-react'
import { cloudTableTagProjection, readCloudWorkspaceTags } from './cloud-table-tags'
import type { CloudWorkspaceTag } from '@/lib/cloud/shared-tags'
import { PageToolbar } from '@/components/shared/PageToolbar'
import { ListEmptyState } from '@/components/shared/ListEmptyState'
import type { FilterOption } from '@/components/shared/FilterSelect'
import { BTN_QUIET, ICON_BTN, SEARCH_ICON, SEARCH_INPUT } from '@/lib/ui-tokens'
import { buildDefaultCharacter } from '@/features/characters/services'
import { buildDefaultCountry } from '@/features/countries/services'
import { buildDefaultEvent } from '@/features/events/services'
import { buildDefaultEntry } from '@/features/world/services'
import { newCharacterData, newCountryData, newEventData, newWorldEntryData } from '@/lib/entity-defaults'
import { isCodexEntry } from '@/lib/entry-kinds'
import { buildEntryTree } from '@/lib/world-tree'
import { TreeTableTabs } from '../TreeTableTabs'
import { TreeTableRow, type EditableField } from '../components/TreeTableRow'
import { readTabOrder, type TreeTableTab } from '../tree-table-tabs'
import { buildCountryTree, flattenCharacterRows, flattenCountryRows, flattenEntryRows,
  flattenEventRows, type RowOptions, type TreeRow } from '../tree-table-rows'
import type { OriginalCharacterSnapshot, OriginalCharactersCloudAdapter } from '@/lib/cloud/adapters/original-characters'
import type { OriginalCountrySnapshot, OriginalCountriesCloudAdapter } from '@/lib/cloud/adapters/original-countries'
import type { OriginalEventSnapshot, OriginalEventsCloudAdapter } from '@/lib/cloud/adapters/original-events'
import type { OriginalNoteSnapshot, OriginalNotesCloudAdapter } from '@/lib/cloud/adapters/original-notes'
import { registerPendingSave } from '@/lib/pending-saves'
import { useWorkspaceDraftGuard } from '@/components/cloud/workspace-editor-guards'

const LABEL: Record<TreeTableTab, string> = { character: '角色', event: '事件', country: '国家', entry: '词条' }
const EMPTY_EXPANDED = new Set<string>()

type Kind = 'character' | 'event' | 'country' | 'world'
export interface WorkspaceTreeTableProps {
  workspaceId: string
  characters: OriginalCharacterSnapshot[]
  countries: OriginalCountrySnapshot[]
  events: OriginalEventSnapshot[]
  notes: OriginalNoteSnapshot[]
  characterAdapter: OriginalCharactersCloudAdapter
  countryAdapter: OriginalCountriesCloudAdapter
  eventAdapter: OriginalEventsCloudAdapter
  noteAdapter: OriginalNotesCloudAdapter
  onCharacterCreated: (snapshot: OriginalCharacterSnapshot) => void
  onCountryCreated: (snapshot: OriginalCountrySnapshot) => void
  onEventCreated: (snapshot: OriginalEventSnapshot) => void
  onNoteCreated: (snapshot: OriginalNoteSnapshot) => void
  onCharacterSaved: (snapshot: OriginalCharacterSnapshot) => void
  onCountrySaved: (snapshot: OriginalCountrySnapshot) => void
  onEventSaved: (snapshot: OriginalEventSnapshot) => void
  onNoteSaved: (snapshot: OriginalNoteSnapshot) => void
  onRefresh: () => Promise<void>
  onNavigate: (kind: Kind, id: number) => void
  canEdit: boolean
  canDelete?: boolean
  disabled: boolean
  loading: boolean
  error?: string | null
}

function description(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请刷新后重试'
}

function selectedKind(row: TreeRow): Kind {
  return row.kind === 'entry' ? 'world' : row.kind === 'group' ? 'country' : row.kind
}

export function WorkspaceTreeTable(props: WorkspaceTreeTableProps) {
  const [tab, setTab] = useState<TreeTableTab>(() => readTabOrder()[0])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const [editing, setEditing] = useState(0)
  const [cloudTags, setCloudTags] = useState<CloudWorkspaceTag[]>([])
  const [tagsRefreshKey, setTagsRefreshKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<Promise<void> | null>(null)
  const writable = props.canEdit && !props.disabled && !saving && !props.loading
  const locked = props.disabled || saving || props.loading

  useEffect(() => {
    let active = true
    void fetch('/api/workspaces/' + props.workspaceId + '/tags', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('无法加载资料库标签')
        return readCloudWorkspaceTags(await response.json())
      })
      .then(tags => { if (active) setCloudTags(tags) })
      .catch(() => { /* Legacy entity tag names remain visible offline. */ })
    return () => { active = false }
  }, [props.workspaceId, tagsRefreshKey])

  const projection = useMemo(() => cloudTableTagProjection(cloudTags, [
    ...props.characters.map(row => row.character),
    ...props.countries.map(row => row.entity),
    ...props.events.map(row => row.entity),
    ...props.notes.map(row => row.entity),
  ]), [cloudTags, props.characters, props.countries, props.events, props.notes])
  const characters = useMemo(() => props.characters.map(row => projection.decorate(row.character)), [props.characters, projection])
  const countries = useMemo(() => props.countries.map(row => projection.decorate(row.entity)), [props.countries, projection])
  const events = useMemo(() => props.events.map(row => projection.decorate(row.entity)), [props.events, projection])
  const entries = useMemo(() => props.notes.map(row => projection.decorate(row.entity)).filter(isCodexEntry), [props.notes, projection])
  const { tagName, tagsById } = projection
  const tree = useMemo(() => buildEntryTree(entries), [entries])
  const countryTree = useMemo(() => buildCountryTree(countries), [countries])
  const query = search.trim().toLowerCase()
  const everything = useMemo(() => {
    const options: RowOptions = { expanded: EMPTY_EXPANDED, query: '', tagName, all: true }
    if (tab === 'entry') return flattenEntryRows(tree, options)
    if (tab === 'country') return flattenCountryRows(countryTree, options)
    if (tab === 'character') return flattenCharacterRows(countryTree, characters, options)
    return flattenEventRows(events, options)
  }, [tab, tree, countryTree, characters, events, tagName])
  const defaultOpen = useMemo(
    () => new Set(everything.filter(row => row.depth === 0 && row.hasChildren).map(row => row.key)), [everything],
  )
  const expanded = useMemo(() => {
    const keys = new Set(defaultOpen)
    for (const key of open) keys.add(key)
    for (const key of closed) keys.delete(key)
    return keys
  }, [defaultOpen, open, closed])
  const options = useMemo<RowOptions>(() => ({ expanded, query, tagName }), [expanded, query])
  const rows = useMemo(() => {
    if (tab === 'entry') return flattenEntryRows(tree, options)
    if (tab === 'country') return flattenCountryRows(countryTree, options)
    if (tab === 'character') return flattenCharacterRows(countryTree, characters, options)
    return flattenEventRows(events, options)
  }, [tab, tree, countryTree, characters, events, options])
  const count = tab === 'entry' ? entries.length : tab === 'country' ? countries.length :
    tab === 'character' ? characters.length : events.length
  const countryOptions = useMemo<FilterOption<number | 'none'>[]>(() => [
    { value: 'none', label: '未归属' },
    ...[...countries].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans'))
      .map(country => ({ value: country.id, label: country.name })),
  ], [countries])

  useEffect(() => registerPendingSave(() => {
    if (editing > 0) throw new Error('表格中仍有正在编辑的单元格，请先提交或取消')
    return pending.current ?? undefined
  }), [editing])
  useWorkspaceDraftGuard(editing > 0 || saving, '表格')

  function toggle(key: string) {
    const current = expanded.has(key)
    setOpen(prev => {
      const next = new Set(prev)
      if (current) next.delete(key)
      else next.add(key)
      return next
    })
    setClosed(prev => {
      const next = new Set(prev)
      if (current) next.add(key)
      else next.delete(key)
      return next
    })
  }
  function expand(key: string) {
    setOpen(prev => new Set(prev).add(key))
    setClosed(prev => { const next = new Set(prev); next.delete(key); return next })
  }
  function expandAll() {
    setOpen(new Set(everything.filter(row => row.hasChildren).map(row => row.key)))
    setClosed(new Set())
  }
  function collapseAll() {
    setOpen(new Set())
    setClosed(new Set(everything.filter(row => row.hasChildren).map(row => row.key)))
  }
  async function write(job: () => Promise<void>): Promise<void> {
    if (!writable || pending.current) throw new Error('当前有操作正在保存，请稍后重试')
    setError(null)
    setSaving(true)
    const task = job()
    pending.current = task
    try {
      await task
    } catch (cause) {
      setError(description(cause))
      throw cause
    } finally {
      pending.current = null
      setSaving(false)
    }
  }

  async function create(tabKind: TreeTableTab, parent?: TreeRow): Promise<void> {
    await write(async () => {
      if (tabKind === 'character') {
        const countryId = parent?.kind === 'group' ? parent.countryId :
          parent?.kind === 'character' ? parent.character?.countryId : undefined
        props.onCharacterCreated(await props.characterAdapter.create(
          buildDefaultCharacter({ ...newCharacterData(), ...(countryId != null ? { countryId } : {}) }),
        ))
      } else if (tabKind === 'country') {
        props.onCountryCreated(await props.countryAdapter.create(buildDefaultCountry({
          ...newCountryData(), ...(parent?.kind === 'country' ? { name: '新子国家', parentId: parent.entityId } : {}),
        })))
      } else if (tabKind === 'event') {
        props.onEventCreated(await props.eventAdapter.create(buildDefaultEvent(newEventData())))
      } else {
        const parentId = parent?.kind === 'entry' ? parent.entityId : null
        const order = entries.filter(entry => entry.parentId === parentId).length
        props.onNoteCreated(await props.noteAdapter.create(buildDefaultEntry({
          ...newWorldEntryData(), ...(parentId === null ? {} : { title: '新子词条' }),
          parentId, order,
        })))
      }
    })
    if (parent) expand(parent.key)
  }

  async function edit(row: TreeRow, field: EditableField, value: string): Promise<void> {
    await write(async () => {
      if (row.kind === 'character') {
        const current = props.characters.find(item => item.character.id === row.entityId)
        if (!current) throw new Error('角色已被删除或修改，请刷新')
        const patch = field === 'race' ? { race: value } : field === 'occupation' ?
          { occupation: value } : { name: value }
        props.onCharacterSaved(await props.characterAdapter.save(current, patch))
      } else if (row.kind === 'country' && field === 'name') {
        const current = props.countries.find(item => item.entity.id === row.entityId)
        if (!current) throw new Error('国家已被删除或修改，请刷新')
        props.onCountrySaved(await props.countryAdapter.save(current, { name: value }))
      } else if (row.kind === 'event' && field === 'title') {
        const current = props.events.find(item => item.entity.id === row.entityId)
        if (!current) throw new Error('事件已被删除或修改，请刷新')
        props.onEventSaved(await props.eventAdapter.save(current, { title: value }))
      } else if (row.kind === 'entry' && field === 'title') {
        const current = props.notes.find(item => item.entity.id === row.entityId && isCodexEntry(item.entity))
        if (!current) throw new Error('词条已被删除或修改，请刷新')
        props.onNoteSaved(await props.noteAdapter.save(current, { title: value }))
      }
    })
  }

  async function setCountry(row: TreeRow, countryId: number | null): Promise<void> {
    try {
      await write(async () => {
        const current = props.characters.find(item => item.character.id === row.entityId)
        if (!current) throw new Error('角色已被删除或修改，请刷新')
        if (countryId !== null && !props.countries.some(item => item.entity.id === countryId)) {
          throw new Error('目标国家不在当前资料库')
        }
        props.onCharacterSaved(await props.characterAdapter.save(current, { countryId }))
      })
      if (countryId != null) expand('group:' + countryId)
    } catch {
      // Error is displayed in the workspace table; the selected value remains unchanged.
    }
  }

  async function remove(row: TreeRow): Promise<void> {
    if (row.kind === 'group' || !props.canDelete || editing > 0) return
    try {
      await write(async () => {
        const snapshots = [
          ...props.characters.map(item => ({ entityId: item.entityId, version: item.version, id: item.character.id, kind: 'character' })),
          ...props.countries.map(item => ({ entityId: item.entityId, version: item.version, id: item.entity.id, kind: 'country' })),
          ...props.events.map(item => ({ entityId: item.entityId, version: item.version, id: item.entity.id, kind: 'event' })),
          ...props.notes.filter(item => isCodexEntry(item.entity)).map(item =>
            ({ entityId: item.entityId, version: item.version, id: item.entity.id, kind: 'entry' })),
        ]
        const target = snapshots.find(item => item.id === row.entityId && item.kind === row.kind)
        if (!target) throw new Error('记录已被其他成员修改，请刷新')
        const response = await fetch('/api/workspaces/' + props.workspaceId + '/table/' + target.entityId, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({expectedVersion: target.version,
            expectedVersions: Object.fromEntries(snapshots.map(item => [item.entityId, item.version]))}),
        })
        if (!response.ok) {
          const result: { error?: string } = await response.json().catch(() => ({}))
          throw new Error(result.error === 'VERSION_CONFLICT'
            ? '关联实体已被其他成员修改，请刷新后再删除'
            : '删除失败：' + (result.error ?? response.status))
        }
        await props.onRefresh()
      })
    } catch {
      // The original DeleteButton closes its confirmation; the table keeps the error visible.
    }
  }

  const addChild = (row: TreeRow) => {
    const kind = row.kind === 'entry' ? 'entry' : row.kind === 'country' ? 'country' : 'character'
    void create(kind, row).catch(() => undefined)
  }
  const handleOpen = (row: TreeRow) => {
    if (row.kind === 'group') toggle(row.key)
    else props.onNavigate(selectedKind(row), row.entityId)
  }
  const handleRefresh = () => {
    if (locked || editing > 0) return
    setTagsRefreshKey(current => current + 1)
    void props.onRefresh().catch(cause => setError(description(cause)))
  }

  return <section className="flex min-w-0 flex-col border-t border-line pt-2">
    <PageToolbar title="表格" className="md:px-3" actions={<>
      <div className="relative"><Search size={14} strokeWidth={2} className={SEARCH_ICON} />
        <input value={search} onChange={event => setSearch(event.target.value)}
          placeholder="搜索当前视图…" aria-label="搜索表格" className={SEARCH_INPUT} />
      </div>
      <span className="hidden text-caption tabular-nums text-ink-faint sm:inline">{count} {LABEL[tab]} · {rows.length} 行</span>
      <button type="button" onClick={handleRefresh} disabled={locked || editing > 0}
        className={ICON_BTN} aria-label="刷新表格" title="刷新"><RotateCw size={14} strokeWidth={2} /></button>
      {everything.some(row => row.hasChildren) && <>
        <button type="button" className={BTN_QUIET} onClick={expandAll}>展开全部</button>
        <button type="button" className={BTN_QUIET} onClick={collapseAll}>折叠全部</button>
      </>}
      {props.canEdit && <button type="button" className={BTN_QUIET}
        disabled={!writable || editing > 0} onClick={() => { void create(tab).catch(() => undefined) }}>
        <Plus size={14} strokeWidth={2} />新增
      </button>}
    </>} />
    {error && <p role="alert" className="px-3 text-ui text-error">{error}</p>}
    {props.error && <p role="alert" className="px-3 text-ui text-error">{props.error}</p>}
    <TreeTableTabs tab={tab} onTabChange={next => { if (!saving && editing === 0) setTab(next) }} />
    <div className="min-h-[18rem] max-h-[72vh] overflow-auto">
      {props.loading && rows.length === 0 ? (
        <p className="p-8 text-center text-ui text-ink-muted">正在读取表格…</p>
      ) : rows.length === 0 ? (
        search ? <ListEmptyState icon={SearchX} message="没有匹配的条目"
          action={{ label: '清除搜索', onClick: () => setSearch('') }} /> :
          <ListEmptyState icon={Table2} message={'还没有' + LABEL[tab]} />
      ) : <table className={'w-full border-collapse text-left text-ui ' +
        (tab === 'character' ? 'min-w-[880px]' : 'min-w-[680px]')}>
        <thead className="sticky top-0 z-10 bg-paper"><tr className="border-b border-line text-caption leading-4 text-ink-faint">
          <th className="py-2 pl-6 font-normal">{tab === 'character' ? '角色 / 国家' : '名称'}</th>
          {tab === 'entry' && <th className="w-48 py-2 pr-4 font-normal">分类</th>}
          {tab === 'country' && <th className="w-48 py-2 pr-4 font-normal">体制</th>}
          {tab === 'event' && <th className="w-44 py-2 pr-4 font-normal">时间</th>}
          {tab === 'character' && <>
            <th className="w-28 py-2 pr-3 font-normal">种族</th>
            <th className="w-36 py-2 pr-3 font-normal">职业</th>
            <th className="w-36 py-2 pr-4 font-normal">所属国家</th>
          </>}
          <th className="w-44 py-2 pr-4 font-normal">标签</th>
          <th className="w-28 py-2 pr-6 font-normal">更新</th>
        </tr></thead>
        <tbody>{rows.map(row => <TreeTableRow key={row.key} row={row} tab={tab}
          tagsById={tagsById} countryOptions={countryOptions}
          busy={locked} readOnly={!props.canEdit} allowDelete={props.canDelete === true && editing === 0}
          onEditingChange={active => setEditing(current => Math.max(0, current + (active ? 1 : -1)))}
          handlers={{
            onOpen: handleOpen, onToggle: toggle, onAddChild: addChild,
            onDelete: row => { void remove(row) }, onEdit: edit, onSetCountry: setCountry,
          }} />)}</tbody>
      </table>}
    </div>
    {props.canEdit && <p className="px-3 py-2 text-micro text-ink-faint">
      名称、种族、职业和国籍可直接编辑，改动按云端条目版本保存。
      {props.canDelete ? '删除父条目时，子条目会提到上一层，成员关联同步清理并保留版本历史。'
        : '删除操作由资料库所有者和管理员执行。'}
    </p>}
  </section>
}

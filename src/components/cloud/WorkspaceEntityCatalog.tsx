'use client'

/**
 * Cloud counterpart of the upstream CharacterList/EventList/CountryList.
 * Reuses the original CoverCard, CoverFlow, SortViewControls, folder bar and
 * move menu, but reads/writes workspace-scoped cloud snapshots only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FolderOpen, Plus, Search, SearchX, Users } from 'lucide-react'
import type { Character, Country, Event } from '@/types'
import { Avatar } from '@/components/shared/Avatar'
import { CoverCard } from '@/components/shared/cover/CoverCard'
import { CoverFlow } from '@/components/shared/CoverFlow'
import { DeleteButton } from '@/components/shared/DeleteButton'
import { SortableList, DragHandle, useSortableItem, moveId } from '@/components/shared/list-dnd'
import { SortViewControls, normalizeViewMode, type ViewMode } from '@/components/shared/SortViewControls'
import { CharacterFolderBar, type FolderFilter } from '@/features/characters/components/CharacterFolderBar'
import { MoveToFolderMenu } from '@/features/characters/components/MoveToFolderMenu'
import { sortCharacters, SORT_OPTIONS as CHARACTER_SORT_OPTIONS } from '@/features/characters/components/character-list-utils'
import { sortCountryList, countryPreview, COUNTRY_SORT_OPTIONS } from '@/features/countries/components/country-list-utils'
import { sortEvents, formatEventTime } from '@/features/events/utils'
import { SORT_OPTIONS as EVENT_SORT_OPTIONS } from '@/features/events/components/event-list-utils'
import { resolveImageUrl } from '@/lib/image-service'
import { coverExcerpt } from '@/lib/cover'
import { flushPendingSaves } from '@/lib/pending-saves'
import { BTN_PRIMARY } from '@/lib/ui-tokens'

export type CatalogKind = 'character' | 'country' | 'event'
export interface CatalogItem {
  entityId: string
  version: number
  data: Character | Country | Event
}
interface CatalogProps {
  workspaceId: string
  kind: CatalogKind
  rows: CatalogItem[]
  countries?: Country[]
  loading: boolean
  error: string | null
  busy: boolean
  selectedId: string | null
  onCreate?: () => void
  onSelect: (id: string) => void
  onDelete?: (item: CatalogItem) => Promise<void>
  onUpdated: () => Promise<void>
}
type FolderResponse = { folders: string[]; version: number }
const LABELS: Record<CatalogKind, string> = { character: '角色', country: '国家', event: '事件' }
const DEFAULT_SORT = 'updatedAt'
const allSorts: Record<CatalogKind, { label: string; value: string }[]> = {
  character: CHARACTER_SORT_OPTIONS,
  country: COUNTRY_SORT_OPTIONS,
  event: EVENT_SORT_OPTIONS,
}

function itemName(kind: CatalogKind, data: CatalogItem['data']) {
  return kind === 'event' ? (data as Event).title : (data as Character | Country).name
}
function itemPreview(kind: CatalogKind, data: CatalogItem['data']) {
  if (kind === 'character') return (data as Character).bio
  if (kind === 'country') return countryPreview(data as Country)
  return (data as Event).summary
}
function itemMeta(kind: CatalogKind, data: CatalogItem['data']) {
  if (kind === 'character') {
    const character = data as Character
    return [character.race, character.nationalityLegacy].filter(Boolean).join(' · ')
  }
  if (kind === 'event') {
    const event = data as Event
    return event.time ? formatEventTime(event.time) : ''
  }
  return ''
}
function iconUrl(kind: CatalogKind, data: CatalogItem['data']) {
  return kind === 'character' ? (data as Character).avatarUrl
    : kind === 'country' ? (data as Country).flagUrl : undefined
}
function readPreference(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}
function writePreference(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* preference remains valid for this session */ }
}
async function catalogRequest(workspaceId: string, body: unknown) {
  const response = await fetch('/api/workspaces/' + workspaceId + '/catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const payload: { error?: string } = await response.json().catch(() => ({}))
    if (response.status === 409) throw new Error('分组或顺序已在其他位置更新，请刷新后重试')
    throw new Error(payload.error ?? '目录保存失败')
  }
  return response.json() as Promise<{ folders?: string[]; folderVersion?: number }>
}

/** Local-only counter: the upstream folders module imports Dexie, which cloud pages must not load. */
function countFolders(characters: Character[], registered: string[]) {
  const counts = new Map<string, number>()
  for (const name of registered) counts.set(name, 0)
  let ungrouped = 0
  for (const character of characters) {
    const folder = (character.folder ?? '').trim()
    if (!folder) ungrouped += 1
    else counts.set(folder, (counts.get(folder) ?? 0) + 1)
  }
  return { folders: [...counts].map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans')), ungrouped }
}

function CloudCatalogRow({ item, kind, label, selected, disabled, sortable, folders, canMove,
  onSelect, onDelete, onMove }: {
  item: CatalogItem
  kind: CatalogKind
  label: string
  selected: boolean
  disabled: boolean
  sortable: boolean
  folders: string[]
  canMove: boolean
  onSelect: () => void
  onDelete?: () => Promise<void>
  onMove: (folder: string | null) => void
}) {
  const { setNodeRef, style, attributes, listeners, cardAttributes, cardListeners } =
    useSortableItem(item.data.id, !sortable)
  const data = item.data
  const avatar = iconUrl(kind, data)
  return <div ref={setNodeRef} style={style} {...cardAttributes} {...cardListeners}
    className={`group flex min-w-0 items-center gap-3 rounded-item border-b border-line/60 px-3 py-2.5 transition-colors hover:bg-[var(--oc-hover)]
      ${selected ? 'bg-[var(--oc-hover)]' : ''}`}>
    {sortable && <DragHandle handleProps={{ attributes, listeners }} />}
    {(kind === 'character' || kind === 'country') &&
      <Avatar src={avatar} type={kind === 'country' ? 'flag' : 'avatar'} size="md" />}
    <button type="button" disabled={disabled} onClick={onSelect}
      className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
      <span className="truncate text-body font-medium text-ink">{itemName(kind, data)}</span>
      <span className="truncate text-caption text-ink-muted">
        {itemMeta(kind, data) || coverExcerpt(itemPreview(kind, data), 80) || '暂无简介'}
      </span>
    </button>
    {canMove && <MoveToFolderMenu folders={folders} current={(data as Character).folder} onMove={onMove} />}
    {onDelete && <DeleteButton onDelete={onDelete} label={'删除' + label} />}
  </div>
}

export function WorkspaceEntityCatalog({
  workspaceId, kind, rows, countries = [], loading, error, busy, selectedId,
  onCreate, onSelect, onDelete, onUpdated,
}: CatalogProps) {
  const label = LABELS[kind]
  const storageKey = 'oc-cloud-' + workspaceId + '-' + kind
  const [search, setSearch] = useState('')
  const [countryFilter, setCountryFilter] = useState<number | 'all'>('all')
  const [sortKey, setSortKey] = useState(DEFAULT_SORT)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [folderFilter, setFolderFilter] = useState<FolderFilter>('all')
  const [registeredFolders, setRegisteredFolders] = useState<string[]>([])
  const [folderVersion, setFolderVersion] = useState(0)
  const [folderLoaded, setFolderLoaded] = useState(kind !== 'character')
  const [operationBusy, setOperationBusy] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const blocked = busy || operationBusy

  useEffect(() => {
    setViewMode(normalizeViewMode(readPreference(storageKey + '-view')))
    const saved = readPreference(storageKey + '-sort')
    setSortKey(allSorts[kind].some(option => option.value === saved) ? saved! : DEFAULT_SORT)
  }, [storageKey, kind])

  const reloadFolders = useCallback(async (): Promise<FolderResponse> => {
    const response = await fetch('/api/workspaces/' + workspaceId + '/catalog', { cache: 'no-store' })
    if (!response.ok) throw new Error('角色分组清单加载失败')
    const result = await response.json() as FolderResponse
    if (!Array.isArray(result.folders) || !Number.isSafeInteger(result.version)) throw new Error('分组清单格式异常')
    setRegisteredFolders(result.folders)
    setFolderVersion(result.version)
    setFolderLoaded(true)
    return result
  }, [workspaceId])

  useEffect(() => {
    if (kind !== 'character') return
    let alive = true
    void fetch('/api/workspaces/' + workspaceId + '/catalog', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('角色分组清单加载失败')
        return response.json() as Promise<FolderResponse>
      }).then(result => {
        if (!alive) return
        if (!Array.isArray(result.folders) || !Number.isSafeInteger(result.version)) throw new Error('分组清单格式异常')
        setRegisteredFolders(result.folders)
        setFolderVersion(result.version)
        setFolderLoaded(true)
      }).catch(cause => { if (alive) setOperationError(cause instanceof Error ? cause.message : '分组清单读取失败') })
    return () => { alive = false }
  }, [kind, workspaceId])

  const characters = useMemo(
    () => kind === 'character' ? rows.map(row => row.data as Character) : [],
    [kind, rows],
  )
  const { folders, ungrouped } = useMemo(() => countFolders(characters, registeredFolders),
    [characters, registeredFolders])
  const knownFolders = folders.map(folder => folder.name)

  const filtered = useMemo(() => rows.filter(item => {
    const data = item.data
    const query = search.trim().toLocaleLowerCase()
    if (query && ![
      itemName(kind, data), itemPreview(kind, data),
      ...(Array.isArray(data.aliases) ? data.aliases : []),
      ...(kind === 'character' ? [(data as Character).race, (data as Character).occupation, (data as Character).faction] : []),
    ].some(part => typeof part === 'string' && part.toLocaleLowerCase().includes(query))) return false
    if (kind === 'character') {
      const character = data as Character
      const folder = (character.folder ?? '').trim()
      if (folderFilter === 'ungrouped' && folder !== '') return false
      if (folderFilter !== 'all' && folderFilter !== 'ungrouped' && folder !== folderFilter) return false
      if (countryFilter !== 'all' && character.countryId !== countryFilter) return false
    }
    return true
  }), [rows, search, kind, folderFilter, countryFilter])

  const sorted = useMemo(() => {
    const ordered = kind === 'character'
      ? sortCharacters(filtered.map(row => row.data as Character), sortKey as Parameters<typeof sortCharacters>[1])
      : kind === 'country'
        ? sortCountryList(filtered.map(row => row.data as Country), sortKey as Parameters<typeof sortCountryList>[1])
        : sortEvents(filtered.map(row => row.data as Event), sortKey as Parameters<typeof sortEvents>[1])
    const byId = new Map(filtered.map(item => [item.data.id, item]))
    return ordered.map(data => byId.get(data.id)!).filter(Boolean)
  }, [kind, filtered, sortKey])

  const canDrag = sortKey === 'manual' && !blocked && !loading && sorted.length > 1

  const updateFolders = async (nextFolders: string[], updates: { id: string; expectedVersion: number; folder: string | null }[]) => {
    if (blocked || !folderLoaded) return false
    setOperationBusy(true)
    setOperationError(null)
    try {
      await flushPendingSaves()
      const result = await catalogRequest(workspaceId, {
        action: 'folders', expectedFolderVersion: folderVersion,
        folders: nextFolders, updates,
      })
      setRegisteredFolders(result.folders ?? nextFolders)
      setFolderVersion(result.folderVersion ?? folderVersion + 1)
      await onUpdated()
      return true
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : '角色分组保存失败')
      await Promise.allSettled([reloadFolders(), onUpdated()])
      return false
    } finally {
      setOperationBusy(false)
    }
  }

  const moveCharacter = async (item: CatalogItem, folder: string | null) => {
    const next = folder?.trim() || null
    const updatedFolders = next && !knownFolders.includes(next) ? [...knownFolders, next] : knownFolders
    await updateFolders(updatedFolders, [{ id: item.entityId, expectedVersion: item.version, folder: next }])
  }

  const renameFolder = async (from: string, to: string) => {
    const next = to.trim()
    if (!next || from === next) return
    if (knownFolders.includes(next)) {
      setOperationError('已有同名文件夹，请换个名称')
      return false
    }
    const saved = await updateFolders(knownFolders.map(name => name === from ? next : name),
      rows.filter(row => kind === 'character' && (row.data as Character).folder === from)
        .map(row => ({ id: row.entityId, expectedVersion: row.version, folder: next })))
    if (saved && folderFilter === from) setFolderFilter(next)
    return saved
  }

  const deleteFolder = async (name: string) => {
    const saved = await updateFolders(knownFolders.filter(folder => folder !== name),
      rows.filter(row => kind === 'character' && (row.data as Character).folder === name)
        .map(row => ({ id: row.entityId, expectedVersion: row.version, folder: null })))
    if (saved && folderFilter === name) setFolderFilter('all')
    return saved
  }

  const createFolder = async (name: string) => {
    const next = name.trim()
    if (!next || knownFolders.includes(next)) return
    return updateFolders([...knownFolders, next], [])
  }

  const reorder = (active: number | string, over: number | string) => {
    if (!canDrag) return
    // Keep every hidden entry in the batch, just as the upstream list does.
    // A filtered folder may be reordered without losing unrelated entries.
    const ordered = kind === 'character'
      ? sortCharacters(rows.map(row => row.data as Character), 'manual')
      : kind === 'country'
        ? sortCountryList(rows.map(row => row.data as Country), 'manual')
        : sortEvents(rows.map(row => row.data as Event), 'manual')
    const ids = ordered.map(data => data.id)
    const moved = moveId(ids, Number(active), Number(over))
    if (moved.every((id, index) => id === ids[index])) return
    const map = new Map(rows.map(item => [item.data.id, item]))
    setOperationBusy(true)
    setOperationError(null)
    void (async () => {
      try {
        await flushPendingSaves()
        await catalogRequest(workspaceId, {
          action: 'reorder', kind,
          entries: moved.map((id, index) => {
            const item = map.get(id)!
            return { id: item.entityId, expectedVersion: item.version, order: index }
          }),
        })
        await onUpdated()
      } catch (cause) {
        setOperationError(cause instanceof Error ? cause.message : '保存顺序失败')
        await Promise.allSettled([onUpdated(), kind === 'character' ? reloadFolders() : Promise.resolve()])
      } finally {
        setOperationBusy(false)
      }
    })()
  }

  const renderCard = (item: CatalogItem) => {
    const data = item.data
    const avatar = iconUrl(kind, data)
    const header = data.headerUrl
    return <CoverCard key={item.entityId} id={data.id} title={itemName(kind, data)}
      intro={coverExcerpt(itemPreview(kind, data), 84)}
      meta={itemMeta(kind, data) || undefined}
      imageSrc={header ? resolveImageUrl(header, 'header') : undefined}
      tintSrc={avatar ? resolveImageUrl(avatar, kind === 'country' ? 'flag' : 'avatar') : undefined}
      emblem={avatar && kind !== 'event' ? <Avatar src={avatar} type={kind === 'country' ? 'flag' : 'avatar'} fill /> : undefined}
      onSelect={() => onSelect(item.entityId)} disabled={blocked} isMobile={false} sortable={canDrag}
      actions={<>
        {kind === 'character' && folderLoaded && !blocked && onCreate &&
          <MoveToFolderMenu tone="overlay" folders={knownFolders} current={(data as Character).folder}
            onMove={folder => void moveCharacter(item, folder)} />}
        {onDelete && !blocked && <DeleteButton tone="overlay" label={'删除' + label}
          onDelete={() => onDelete(item)} />}
      </>} />
  }

  const renderRow = (item: CatalogItem) => <CloudCatalogRow key={item.entityId}
    item={item} kind={kind} label={label} selected={selectedId === item.entityId}
    disabled={blocked} sortable={canDrag} folders={knownFolders}
    canMove={kind === 'character' && folderLoaded && !blocked && Boolean(onCreate)}
    onSelect={() => onSelect(item.entityId)}
    onDelete={onDelete && !blocked ? () => onDelete(item) : undefined}
    onMove={folder => void moveCharacter(item, folder)} />

  return <section className="min-w-0 overflow-hidden rounded-panel border border-line bg-paper">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
      <div className="flex items-baseline gap-2">
        <h2 className="font-serif text-lg font-semibold text-ink">{label}</h2>
        <span className="text-caption tabular-nums text-ink-faint">{filtered.length} / {rows.length}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-control border border-line bg-paper-alt px-3 sm:max-w-52">
          <Search size={15} className="shrink-0 text-ink-faint" aria-hidden />
          <input type="search" value={search} onChange={event => setSearch(event.target.value)}
            placeholder={'搜索' + label + '…'} aria-label={'搜索' + label}
            className="w-full min-w-0 bg-transparent text-ui text-ink outline-none placeholder:text-ink-faint" />
        </label>
        <SortViewControls sortKey={sortKey}
          onSortChange={key => { setSortKey(key); writePreference(storageKey + '-sort', key) }}
          sortOptions={allSorts[kind]}
          viewMode={viewMode}
          onViewModeChange={mode => { setViewMode(mode); writePreference(storageKey + '-view', mode) }} />
        {onCreate && <button type="button" disabled={blocked || loading || Boolean(error)} onClick={onCreate}
          className={`${BTN_PRIMARY} border border-line shadow-sm hover:border-line-hover`}>
          <Plus size={16} strokeWidth={2} aria-hidden />新建{label}
        </button>}
      </div>
    </div>
    {kind === 'character' && <div className="border-b border-line/70 pt-3">
      <CharacterFolderBar folders={folders} total={characters.length} ungrouped={ungrouped}
        value={folderFilter} readOnly={!onCreate || blocked || !folderLoaded} onChange={setFolderFilter} onRename={renameFolder}
        onDelete={deleteFolder} onCreate={createFolder} />
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3 text-caption text-ink-muted">
        <Users size={14} aria-hidden />
        <label htmlFor={'country-filter-' + workspaceId}>所属国家</label>
        <select id={'country-filter-' + workspaceId} value={countryFilter}
          onChange={event => setCountryFilter(event.target.value === 'all' ? 'all' : Number(event.target.value))}
          className="h-8 rounded-item border border-line bg-paper-alt px-2 text-ui text-ink">
          <option value="all">全部国家</option>
          {countries.map(country => <option key={country.id} value={country.id}>{country.name}</option>)}
        </select>
        {sortKey === 'manual' && <span>拖动可调整顺序，其他分组的角色保持原有相对顺序</span>}
      </div>
    </div>}
    {(error || operationError) && <p role="alert" className="px-5 py-3 text-ui text-error">{error || operationError}</p>}
    {loading && <p className="px-5 py-8 text-center text-ui text-ink-muted">正在读取{label}…</p>}
    {!loading && !error && sorted.length === 0 &&
      <div className="flex min-h-48 flex-col items-center justify-center gap-2 p-7 text-ink-faint">
        {search ? <SearchX size={28} strokeWidth={1.5} /> : kind === 'character' ? <Users size={28} strokeWidth={1.5} /> : <FolderOpen size={28} strokeWidth={1.5} />}
        <p className="text-ui">{search ? '没有找到匹配的' + label : '暂无' + label}</p>
      </div>}
    {!loading && !error && sorted.length > 0 && viewMode === 'gallery' &&
      <div className="h-[22rem] min-h-0 sm:h-[28rem]">
        <SortableList ids={sorted.map(item => item.data.id)} layout="grid" disabled={!canDrag} onReorder={reorder}>
          <CoverFlow className="h-full" itemWidth={300}>
            {sorted.map(renderCard)}
          </CoverFlow>
        </SortableList>
      </div>}
    {!loading && !error && sorted.length > 0 && viewMode === 'grid' &&
      <SortableList ids={sorted.map(item => item.data.id)} layout="grid" disabled={!canDrag} onReorder={reorder}>
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {sorted.map(renderCard)}
        </div>
      </SortableList>}
    {!loading && !error && sorted.length > 0 && viewMode === 'list' &&
      <SortableList ids={sorted.map(item => item.data.id)} layout="list" disabled={!canDrag} onReorder={reorder}>
        <div className="flex flex-col p-2 sm:p-3">{sorted.map(renderRow)}</div>
      </SortableList>}
    {operationBusy && <p role="status" className="border-t border-line px-5 py-2 text-caption text-ink-muted">正在同步目录修改…</p>}
  </section>
}

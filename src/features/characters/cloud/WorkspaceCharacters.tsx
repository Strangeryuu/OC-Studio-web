'use client'

import dynamic from 'next/dynamic'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Providers } from '@/app/providers'
import { SaveStatusProvider, useSaveStatus } from '@/components/layout/SaveStatusContext'
import { Toaster } from '@/components/shared/toaster'
import { GalleryBlock, SummaryBlock } from '@/components/shared/template-blocks'
import { CharacterInfoSection } from '@/features/characters/components/CharacterInfoSection'
import { characterFormBaseline, useCharacterForm } from '@/features/characters/hooks/useCharacterForm'
import { buildDefaultCharacter } from '@/features/characters/services'
import type { CharacterFormData } from '@/features/characters/types'
import { newCharacterData, newCountryData, newEventData, newWorldEntryData } from '@/lib/entity-defaults'
import { BUILTIN_FIELDS } from '@/lib/fields'
import { flushPendingSaves, registerPendingSave } from '@/lib/pending-saves'
import { BTN_PRIMARY, BTN_QUIET, TITLE_INPUT } from '@/lib/ui-tokens'
import { OriginalCharactersCloudAdapter, type OriginalCharacterSnapshot, type OriginalCharacterPatch } from '@/lib/cloud/adapters/original-characters'
import type { WorkspaceRole } from '@/lib/cloud/permissions'
import type { Character, Country, WorldEntry } from '@/types'
import type { Editor } from '@tiptap/core'
import { EditorCore } from '@/components/editor/EditorCore'
import { ActiveEditorProvider } from '@/lib/editor-context'
import { legacyBodySections } from '@/lib/body-content'
import { hasNewBodyImages } from '@/lib/cloud/character-media'
import { ProfileBannerEditor } from '@/components/shared/ProfileBannerEditor'
import type { RelationTargetKind } from '@/components/shared/relations/types'
import { RelationsSection } from '@/components/shared/relations/RelationsSection'

import { OriginalCountriesCloudAdapter } from '@/lib/cloud/adapters/original-countries'
import { OriginalCountryEditor } from '@/features/countries/cloud/OriginalCountryEditor'
import { OriginalEventEditor } from '@/features/events/cloud/OriginalEventEditor'
import { buildDefaultEvent } from '@/features/events/services'
import { OriginalEventsCloudAdapter } from '@/lib/cloud/adapters/original-events'
import { TimelineView } from '@/features/timeline/components/TimelineView'
import { useDelayedFlag } from '@/lib/use-delayed-flag'
import { buildDefaultCountry } from '@/features/countries/services'
import { WorkspaceNavigation, type WorkspaceSection } from '@/components/cloud/WorkspaceNavigation'
import { WorkspaceEntityHistory } from '@/components/cloud/WorkspaceEntityHistory'
import { insertWorkspaceBodyImage, useWorkspaceDraftGuard, useWorkspaceImageUpload } from '@/components/cloud/workspace-editor-guards'

import { OriginalNotesCloudAdapter } from '@/lib/cloud/adapters/original-notes'
import { OriginalNoteEditor } from '@/features/world/cloud/OriginalNoteEditor'
import { WorkspaceNoteTree } from '@/features/world/cloud/WorkspaceNoteTree'
import { buildDefaultEntry } from '@/features/world/services'
import { isCodexEntry } from '@/lib/entry-kinds'
import { defaultWorkspaceCustomization, type WorkspaceCustomization } from '@/lib/cloud/workspace-customization'
import type { Category } from '@/lib/categories/types'
import type { CloudSearchHit } from '@/lib/cloud/workspace-search'
import type { ReferableEntity } from '@/lib/reference-registry'

import { projectGraphData } from '@/features/relations/services'
import type { RelationNodeType } from '@/features/relations/types'
import { TooltipProvider } from '@/components/ui/tooltip'

const WorkspaceHome = dynamic(
  () => import('@/features/dashboard/cloud/WorkspaceHome').then(mod => mod.WorkspaceHome),
  { ssr: false },
)

const WorkspaceAlbum = dynamic(
  () => import('@/features/album/cloud/WorkspaceAlbum').then(mod => mod.WorkspaceAlbum),
  { ssr: false },
)

const WorkspaceNovel = dynamic(
  () => import('@/features/novel/cloud/WorkspaceNovel').then(mod => mod.WorkspaceNovel),
  { ssr: false },
)

const WorkspaceTrash = dynamic(
  () => import('@/features/trash/cloud/WorkspaceTrash').then(m=>m.WorkspaceTrash),{ssr:false})
const WorkspaceCustomizationPanel = dynamic(
  () => import('@/features/categories/cloud/WorkspaceCustomizationPanel').then(m=>m.WorkspaceCustomizationPanel),{ssr:false})
const WorkspaceSearch = dynamic(
  () => import('@/features/search/cloud/WorkspaceSearch').then(m=>m.WorkspaceSearch),{ssr:false})
const WorkspaceBackup = dynamic(
  () => import('@/features/backup/cloud/WorkspaceBackup').then(m=>m.WorkspaceBackup),{ssr:false})

const WorkspaceTreeTable = dynamic(
  () => import('@/features/tree-table/cloud/WorkspaceTreeTable').then(mod => mod.WorkspaceTreeTable),
  { ssr: false },
)

const WorkspaceMaps = dynamic(
  () => import('@/features/map/cloud/WorkspaceMaps').then(module => module.WorkspaceMaps),
  { ssr: false },
)

const RelationGraph = dynamic(
  () => import('@/features/relations/components/RelationGraph').then(module => module.RelationGraph),
  { ssr: false },
)

const CLOUD_FIELDS = BUILTIN_FIELDS.character
const EDITABLE_KEYS = [
  'name', 'aliases', 'race', 'element', 'occupation', 'faction',
  'height', 'birthday', 'isMajor', 'bio', 'avatarUrl', 'headerUrl', 'nationalityLegacy',
] as const satisfies readonly (keyof CharacterFormData)[]

export function editablePatch(character: Character, values: Partial<CharacterFormData>): OriginalCharacterPatch {
  const result: OriginalCharacterPatch = {}
  const baseline = characterFormBaseline(character)
  for (const key of EDITABLE_KEYS) {
    const value = values[key]
    if (value !== undefined && JSON.stringify(value) !== JSON.stringify(baseline[key])) {
      Object.assign(result, { [key]: value })
    }
  }
  if ('countryId' in values && (values.countryId ?? null) !== baseline.countryId) {
    result.countryId = values.countryId ?? null
  }
  if (values.relatedCharacters !== undefined) {
    const normalized = values.relatedCharacters.map(relation => ({
      characterId: relation.characterId ?? null, relation: relation.relation,
      arrow: relation.arrow ?? null, color: relation.color ?? null,
    }))
    if (JSON.stringify(normalized) !== JSON.stringify(baseline.related)) {
      result.relatedCharacters = values.relatedCharacters
    }
  }
  if (values.relatedNotes !== undefined) {
    const normalized = values.relatedNotes.map(relation => ({
      targetId: relation.targetId ?? null, relation: relation.relation,
      arrow: relation.arrow ?? null, color: relation.color ?? null,
    }))
    if (JSON.stringify(normalized) !== JSON.stringify(baseline.relatedNotes)) {
      result.relatedNotes = values.relatedNotes
    }
  }
  for (const key of ['avatars', 'gallery'] as const) {
    const next = values[key]
    if (!next) continue
    const urls = next.map(item => item.url)
    if (JSON.stringify(urls) === JSON.stringify(baseline[key])) continue
    const original = Array.isArray(character[key]) ? character[key] : []
    const used = new Set<number>()
    const nextUrlSet = new Set(urls)
    const merged = next.map((item, index) => {
      const urlOf = (entry: unknown) => typeof entry === 'string' ? entry : entry && typeof entry === 'object' && 'url' in entry ? entry.url : undefined
      let oldIndex = original.findIndex((entry, i) => !used.has(i) && urlOf(entry) === item.url)
      if (oldIndex < 0 && original[index] && !used.has(index) && !nextUrlSet.has(String(urlOf(original[index])))) oldIndex = index
      if (oldIndex < 0) return item
      used.add(oldIndex)
      const old = original[oldIndex]
      return typeof old === 'object' && old !== null ? { ...old, url: item.url } : item
    })
    Object.assign(result, { [key]: merged })
  }
  return result
}

interface WorkspaceProps {
  workspaceId: string
  role: WorkspaceRole
  workspaceName?: string
  workspaceDescription?: string | null
  membersPanel?: ReactNode
}

export function WorkspaceCharacters(props: WorkspaceProps) {
  return <Providers><TooltipProvider><ActiveEditorProvider><SaveStatusProvider>
    <CharacterWorkspace key={props.workspaceId} {...props} />
    <Toaster />
  </SaveStatusProvider></ActiveEditorProvider></TooltipProvider></Providers>
}

function useWorkspaceRows<T extends { entityId: string }>(adapter: { list: () => Promise<T[]> }, label: string) {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    void adapter.list().then(result => {
      if (current) setRows(result)
    }).catch(cause => {
      if (current) setError(cause instanceof Error ? cause.message : label + '加载失败')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [adapter, label])
  const append = useCallback((row: T) => setRows(current => [...current, row]), [])
  const replace = useCallback((row: T) => {
    setRows(current => current.map(item => item.entityId === row.entityId ? row : item))
  }, [])
  const reset = useCallback((result: T[]) => {
    setRows(result)
    setError(null)
    setLoading(false)
  }, [])
  return { rows, loading, error, append, replace, reset }
}

function WorkspaceEntryList<T extends { entityId: string }>({ label, rows, getLabel, selectedId, loading,
  error, busy, onCreate, onSelect }: {
  label: string
  rows: T[]
  getLabel: (row: T) => string
  selectedId: string | null
  loading: boolean
  error: string | null
  busy: boolean
  onCreate?: () => void
  onSelect: (entityId: string) => void
}) {
  const showLoading = useDelayedFlag(loading)
  return <section className="flex flex-col gap-4 border-t border-line pt-5">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-reading font-semibold">{label}</h2>
      {onCreate && <button type="button" className={BTN_QUIET} disabled={busy || loading || error !== null}
        onClick={onCreate}>新建{label}</button>}
    </div>
    {error && <p role="alert" className="text-ui text-error">{error}</p>}
    {showLoading && <p className="text-ui text-ink-muted">正在读取{label}…</p>}
    {!loading && <div className="flex flex-wrap gap-2">
      {rows.map(row => <button type="button" key={row.entityId} className={BTN_QUIET}
        aria-pressed={selectedId === row.entityId} disabled={busy}
        onClick={() => onSelect(row.entityId)}>{getLabel(row)}</button>)}
      {rows.length === 0 && !error && <p className="text-ui text-ink-muted">暂无{label}</p>}
    </div>}
  </section>
}

function CharacterWorkspace({ workspaceId, role, workspaceName, workspaceDescription, membersPanel }: WorkspaceProps) {
  const characterAdapter = useMemo(() => new OriginalCharactersCloudAdapter(workspaceId), [workspaceId])
  const countryAdapter = useMemo(() => new OriginalCountriesCloudAdapter(workspaceId), [workspaceId])
  const eventAdapter = useMemo(() => new OriginalEventsCloudAdapter(workspaceId), [workspaceId])
  const noteAdapter = useMemo(() => new OriginalNotesCloudAdapter(workspaceId), [workspaceId])
  const noteList = useWorkspaceRows(noteAdapter, '笔记')
  const characterList = useWorkspaceRows(characterAdapter, '角色')
  const countryList = useWorkspaceRows(countryAdapter, '国家')
  const eventList = useWorkspaceRows(eventAdapter, '事件')
  const [section, setSection] = useState<WorkspaceSection>('character')
  const [customization,setCustomization]=useState<WorkspaceCustomization>(defaultWorkspaceCustomization)
  const [configurationRefresh,setConfigurationRefresh]=useState(0)
  const [activeCategoryId,setActiveCategoryId]=useState<string|null>(null)
  const [novelFocusId,setNovelFocusId]=useState<number|null>(null)
  useEffect(()=>{
    let active=true
    void fetch('/api/workspaces/'+workspaceId+'/customization',{cache:'no-store'})
      .then(async response=>{
        if(!response.ok)throw new Error('资料库分类读取失败')
        return response.json() as Promise<{customization:WorkspaceCustomization}>
      })
      .then(result=>{if(active)setCustomization(result.customization)})
      .catch(()=>undefined)
    return()=>{active=false}
  },[workspaceId,configurationRefresh])
  const [leaving, setLeaving] = useState(false)
  const transition = useRef(false)
  const pendingGraphWrite = useRef<Promise<void> | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)
  useEffect(() => registerPendingSave(() => pendingGraphWrite.current ?? undefined), [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canEdit = role !== 'viewer'
  const character = characterList.rows.find(row => row.entityId === selectedId)
  const country = countryList.rows.find(row => row.entityId === selectedId)
  const event = eventList.rows.find(row => row.entityId === selectedId)
  const characters = useMemo(() => characterList.rows.map(row => row.character), [characterList.rows])
  const countries = useMemo(() => countryList.rows.map(row => row.entity), [countryList.rows])
  const events = useMemo(() => eventList.rows.map(row => row.entity), [eventList.rows])

  const notes = useMemo(() => noteList.rows.map(row => row.entity).filter(isCodexEntry), [noteList.rows])
  const activeCategory=customization.categories.find(c=>c.id===activeCategoryId)??null
  const visibleCategories=customization.categories.filter(c=>c.enabled)
  const worldNotes=notes.filter(row=>
    !visibleCategories.some(category=>category.name===row.category))
  const novelRoots = useMemo(() => noteList.rows.filter(row => row.entity.category === '小说' && row.entity.parentId == null), [noteList.rows])
  const mapEntries = useMemo(() => noteList.rows.filter(row => row.entity.category === '地图'), [noteList.rows])
  const note = noteList.rows.find(row => row.entityId === selectedId && isCodexEntry(row.entity))
  const categoryNote=activeCategory ? noteList.rows.find(row =>
    row.entityId===selectedId && row.entity.category===activeCategory.name) : undefined
  const graph = useMemo(
    () => section === 'relations' ? projectGraphData({ characters, countries, events, notes }, true) : null,
    [section, characters, countries, events, notes],
  )
  const references = useMemo<ReferableEntity[]>(() => {
    return [
      ...characters.map(row => ({ type: 'character', id: String(row.id), name: row.name, keywords: row.aliases, avatarUrl: row.avatarUrl })),
      ...countries.map(row => ({ type: 'country', id: String(row.id), name: row.name, keywords: row.aliases ?? [], avatarUrl: row.flagUrl })),
      ...events.map(row => ({ type: 'event', id: String(row.id), name: row.title, keywords: row.aliases ?? [] })),
      ...notes.map(row => ({ type: 'world', id: String(row.id), name: row.title, keywords: row.aliases ?? [] })),
    ]
  }, [characters, countries, events, notes])

  useEffect(() => {
    if (leaving) window.location.assign('/')
  }, [leaving])

  async function openAfterSaving(nextSection: WorkspaceSection, next: () => Promise<string | null>) {
    if (busy || transition.current) return
    transition.current = true
    setBusy(true)
    setError(null)
    try {
      await flushPendingSaves()
      const nextId = await next()
      setSelectedId(nextId)
      setSection(nextSection)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法打开条目')
    } finally {
      transition.current = false
      setBusy(false)
    }
  }

  function select(entityId: string, nextSection: WorkspaceSection) {
    if (entityId !== selectedId) void openAfterSaving(nextSection, async () => entityId)
  }

  function navigate(kind: RelationTargetKind, id: number) {
    if (kind !== 'character' && kind !== 'country' && kind !== 'event' && kind !== 'world') return
    const target = kind === 'character' ? characterList.rows.find(row => row.character.id === id)
      : kind === 'country' ? countryList.rows.find(row => row.entity.id === id)
      : kind === 'event' ? eventList.rows.find(row => row.entity.id === id)
      : noteList.rows.find(row => row.entity.id === id && isCodexEntry(row.entity))
    if (target) select(target.entityId, kind)
  }

  function createNote(parentId: number | null, category?: Category | null) {
    if (!canEdit) return
    void openAfterSaving(category ? 'category' : 'world', async () => {
      const draft = buildDefaultEntry({ ...newWorldEntryData(), parentId,
        ...(category?{category:category.name,template:category.template}:{}) })
      const row = await noteAdapter.create(draft)
      noteList.append(row)
      return row.entityId
    })
  }

  function openSearchHit(hit:CloudSearchHit) {
    if(hit.kind==='novel'){
      void openAfterSaving('novel',async()=>{setNovelFocusId(hit.localId);return null})
    }else if(hit.kind==='map'){
      void openAfterSaving('map',async()=>null)
    }else{
      const targetSection:WorkspaceSection=hit.kind==='world'?'world':hit.kind
      const found=hit.kind==='world'&&hit.category?
        visibleCategories.find(category=>category.name===hit.category):undefined
      void openAfterSaving(found?'category':targetSection,async()=>{
        if(found)setActiveCategoryId(found.id)
        return hit.entityId
      })
    }
  }

  async function saveTimelineTime(id: number, time: string, endTime?: string) {
    if (busy || !canEdit) return
    const current = eventList.rows.find(row => row.entity.id === id)
    if (!current) throw new Error('事件未找到')
    setBusy(true)
    try {
      const saved = await eventAdapter.save(current, { time, endTime })
      eventList.replace(saved)
    } finally {
      setBusy(false)
    }
  }

  async function refreshMapRows() {
    const [nextCountries, nextEvents, nextNotes] = await Promise.all([
      countryAdapter.list(), eventAdapter.list(), noteAdapter.list(),
    ])
    countryList.reset(nextCountries)
    eventList.reset(nextEvents)
    noteList.reset(nextNotes)
  }

  async function refreshGraph() {
    if (busy || transition.current || pendingGraphWrite.current) return
    transition.current = true
    setBusy(true)
    try {
      const [nextCharacters, nextCountries, nextEvents, nextNotes] = await Promise.all([
        characterAdapter.list(), countryAdapter.list(), eventAdapter.list(), noteAdapter.list(),
      ])
      characterList.reset(nextCharacters)
      countryList.reset(nextCountries)
      eventList.reset(nextEvents)
      noteList.reset(nextNotes)
      setGraphError(null)
    } catch (cause) {
      setGraphError(cause instanceof Error ? cause.message : '图谱刷新失败')
    } finally {
      transition.current = false
      setBusy(false)
    }
  }

  async function writeGraphPosition(type: RelationNodeType, id: number, position: { x: number; y: number }) {
    const patch = { graphPosition: position }
    if (type === 'character') {
      const current = characterList.rows.find(row => row.character.id === id)
      if (current) { characterList.replace(await characterAdapter.save(current, patch)); return }
    } else if (type === 'country') {
      const current = countryList.rows.find(row => row.entity.id === id)
      if (current) { countryList.replace(await countryAdapter.save(current, patch)); return }
    } else if (type === 'event') {
      const current = eventList.rows.find(row => row.entity.id === id)
      if (current) { eventList.replace(await eventAdapter.save(current, patch)); return }
    } else {
      const current = noteList.rows.find(row => row.entity.id === id && isCodexEntry(row.entity))
      if (current) { noteList.replace(await noteAdapter.save(current, patch)); return }
    }
    throw new Error('条目未找到，请刷新关系图')
  }

  async function saveGraphPosition(type: RelationNodeType, id: number, x: number, y: number) {
    if (busy || !canEdit || pendingGraphWrite.current) throw new Error('当前无法保存节点位置')
    setBusy(true)
    const write = writeGraphPosition(type, id, { x, y })
    pendingGraphWrite.current = write
    try {
      await write
    } finally {
      pendingGraphWrite.current = null
      setBusy(false)
    }
  }

  return <div className="grid min-w-0 gap-5 md:grid-cols-[10rem_minmax(0,1fr)]">
    {workspaceName && <header className="md:col-span-2">
      <h1 className="text-lg font-semibold">{workspaceName}</h1>
      {workspaceDescription && <p className="mt-1 text-ui text-ink-muted">{workspaceDescription}</p>}
    </header>}
    <WorkspaceNavigation active={section} busy={busy || leaving} hasMembers={membersPanel !== undefined}
      categories={customization.categories} activeCategoryId={activeCategoryId}
      onSelectCategory={id => void openAfterSaving('category',async()=>{setActiveCategoryId(id);return null})}
      onSelect={next => {
        if (next !== section) void openAfterSaving(next, async () => {
          if(next==='novel')setNovelFocusId(null)
          return null
        })
      }}
      onSwitchWorkspace={workspaceName ? () => void openAfterSaving(section, async () => {
        setLeaving(true)
        return null
      }) : undefined} />
    <div className="flex min-w-0 flex-col gap-4">
      {error && <p role="alert" className="text-ui text-error">{error}</p>}
      {section === 'home' && <WorkspaceHome workspaceId={workspaceId}
        canUpdate={role === 'owner' || role === 'admin'} worldName={workspaceName ?? '未命名世界'}
        tagline={workspaceDescription ?? ''} characters={characters} events={events} countries={countries}
        entries={notes} novels={novelRoots.length} maps={mapEntries.length}
        onNavigate={(id, kind) => navigate(kind as RelationTargetKind, id)}
        onOpenSection={item => {
          const sections: Record<string, WorkspaceSection> = {
            '角色': 'character', '事件': 'event', '国家': 'country',
            '世界观': 'world', '小说': 'novel', '地图': 'map',
          }
          const next = sections[item]
          if (next) void openAfterSaving(next, async () => null)
        }}
        showCreate={canEdit} onCreate={type => {
          if (!canEdit) return
          void openAfterSaving(type, async () => {
            if (type === 'character') {
              const row = await characterAdapter.create(buildDefaultCharacter(newCharacterData()))
              characterList.append(row)
              return row.entityId
            }
            if (type === 'country') {
              const row = await countryAdapter.create(buildDefaultCountry(newCountryData()))
              countryList.append(row)
              return row.entityId
            }
            const row = await eventAdapter.create(buildDefaultEvent(newEventData()))
            eventList.append(row)
            return row.entityId
          })
        }} />}
      {section === 'album' && <WorkspaceAlbum workspaceId={workspaceId} worldName={workspaceName ?? '世界'}
        characters={characterList.rows} countries={countryList.rows}
        events={eventList.rows} notes={noteList.rows}
        loading={characterList.loading || countryList.loading || eventList.loading || noteList.loading}
        error={graphError || characterList.error || countryList.error || eventList.error || noteList.error}
        onNavigate={(kind,id) => navigate(kind,id)} onRefresh={refreshGraph} />}
      {section === 'novel' && <WorkspaceNovel workspaceId={workspaceId} focusEntryId={novelFocusId}
        notes={noteList.rows} loading={noteList.loading} error={noteList.error}
        adapter={noteAdapter} canEdit={canEdit} canDelete={role === 'owner' || role === 'admin'} disabled={busy}
        onCreated={noteList.append} onSaved={noteList.replace} onRefresh={refreshGraph} />}
      {section === 'character' && <WorkspaceEntryList label="角色" rows={characterList.rows} loading={characterList.loading} error={characterList.error}
        getLabel={row => row.character.name} selectedId={selectedId} busy={busy} onSelect={id => select(id, 'character')}
        onCreate={canEdit ? () => void openAfterSaving('character', async () => {
          const row = await characterAdapter.create(buildDefaultCharacter(newCharacterData()))
          characterList.append(row)
          return row.entityId
        }) : undefined} />}
      {section === 'country' && <WorkspaceEntryList label="国家" rows={countryList.rows} loading={countryList.loading} error={countryList.error}
        getLabel={row => row.entity.name} selectedId={selectedId} busy={busy} onSelect={id => select(id, 'country')}
        onCreate={canEdit ? () => void openAfterSaving('country', async () => {
          const row = await countryAdapter.create(buildDefaultCountry(newCountryData()))
          countryList.append(row)
          return row.entityId
        }) : undefined} />}
      {section === 'event' && <WorkspaceEntryList label="事件" rows={eventList.rows} loading={eventList.loading} error={eventList.error}
        getLabel={row => row.entity.title} selectedId={selectedId} busy={busy} onSelect={id => select(id, 'event')}
        onCreate={canEdit ? () => void openAfterSaving('event', async () => {
          const row = await eventAdapter.create(buildDefaultEvent(newEventData()))
          eventList.append(row)
          return row.entityId
        }) : undefined} />}
      {section === 'world' && <WorkspaceNoteTree entries={worldNotes} selectedId={note?.entity.id} loading={noteList.loading}
        error={noteList.error} busy={busy} onSelect={id => navigate('world', id)}
        onCreate={canEdit ? () => createNote(null) : undefined} />}
      {section === 'table' && <WorkspaceTreeTable workspaceId={workspaceId}
        characters={characterList.rows} countries={countryList.rows} events={eventList.rows} notes={noteList.rows}
        characterAdapter={characterAdapter} countryAdapter={countryAdapter}
        eventAdapter={eventAdapter} noteAdapter={noteAdapter}
        onCharacterCreated={characterList.append} onCountryCreated={countryList.append}
        onEventCreated={eventList.append} onNoteCreated={noteList.append}
        onCharacterSaved={characterList.replace} onCountrySaved={countryList.replace}
        onEventSaved={eventList.replace} onNoteSaved={noteList.replace}
        onRefresh={refreshGraph} onNavigate={(kind, id) => navigate(kind, id)}
        canEdit={canEdit} canDelete={role === 'owner' || role === 'admin'} disabled={busy}
        loading={characterList.loading || countryList.loading || eventList.loading || noteList.loading}
        error={graphError || characterList.error || countryList.error || eventList.error || noteList.error} />}
      {section === 'map' && <WorkspaceMaps workspaceId={workspaceId}
        rows={noteList.rows} countries={countryList.rows} events={eventList.rows}
        noteAdapter={noteAdapter} countryAdapter={countryAdapter} eventAdapter={eventAdapter}
        onMapCreated={noteList.append} onMapSaved={noteList.replace}
        onCountrySaved={countryList.replace} onEventSaved={eventList.replace}
        onReconciled={refreshMapRows} onNavigate={(kind, id) => navigate(kind, id)}
        canEdit={canEdit} canDelete={role === 'owner' || role === 'admin'} disabled={busy}
        loading={noteList.loading || countryList.loading || eventList.loading}
        error={noteList.error || countryList.error || eventList.error} />}
      {section === 'timeline' && <div className="h-[65vh] min-h-96 rounded-panel border border-line">
        <TimelineView workspace={{
          characters, countries, events,
          loading: eventList.loading || countryList.loading || characterList.loading,
          error: eventList.error || countryList.error || characterList.error,
          saveTime: canEdit ? saveTimelineTime : undefined,
        }}
          onSelectCharacter={id => navigate('character', id)}
          onSelectCountry={id => navigate('country', id)}
          onSelectEvent={id => navigate('event', id)} />
      </div>}
      {graph && <div className="h-[70vh] min-h-96 rounded-panel border border-line">
        <RelationGraph workspace={{
          ...graph,
          loading: characterList.loading || countryList.loading || eventList.loading || noteList.loading,
          error: graphError || characterList.error || countryList.error || eventList.error || noteList.error,
          refresh: refreshGraph,
          savePosition: canEdit && !busy ? saveGraphPosition : undefined,
        }}
          onNavigateToCharacter={id => navigate('character', id)}
          onNavigateToCountry={id => navigate('country', id)}
          onNavigateToEvent={id => navigate('event', id)}
          onNavigateToWorld={id => navigate('world', id)} />
      </div>}
      {section === 'trash' && <WorkspaceTrash workspaceId={workspaceId}
        canManage={role==='owner'||role==='admin'} onRestored={refreshGraph}/>}
      {section === 'settings' && <WorkspaceCustomizationPanel workspaceId={workspaceId}
        canManage={role==='owner'||role==='admin'}
        onSaved={()=>setConfigurationRefresh(v=>v+1)} />}
      {section === 'search' && <WorkspaceSearch workspaceId={workspaceId} onOpen={openSearchHit} />}
      {section === 'backup' && <WorkspaceBackup workspaceId={workspaceId} workspaceName={workspaceName??'世界观'}
        canExport={role!=='viewer'} canImport={role==='owner'||role==='admin'}
        onImported={async()=>{setConfigurationRefresh(v=>v+1);await refreshGraph()}} />}
      {section === 'category' && activeCategory && <WorkspaceNoteTree key={activeCategory.id}
        entries={notes.filter(row=>row.category===activeCategory.name)}
        selectedId={categoryNote?.entity.id} loading={noteList.loading}
        error={noteList.error} busy={busy} onSelect={id=>{
          const found=noteList.rows.find(row=>row.entity.id===id)
          if(found)select(found.entityId,'category')
        }}
        onCreate={canEdit?()=>createNote(null,activeCategory):undefined}/>}
      {section === 'category' && activeCategory && categoryNote &&
        <OriginalNoteEditor key={categoryNote.entityId} snapshot={categoryNote} adapter={noteAdapter}
          notes={notes} characters={characters} references={references} canEdit={canEdit} disabled={busy}
          onSaved={noteList.replace} onUploadBusy={setBusy} onNavigate={navigate}
          onCreateChild={()=>createNote(categoryNote.entity.id,activeCategory)}/>}
      {section === 'character' && character && <OriginalCharacterEditor key={character.entityId} snapshot={character} adapter={characterAdapter}
        characters={characters} countries={countries} countriesReady={!countryList.loading && !countryList.error}
        notes={notes} onNavigateRelation={navigate}
        onNavigateCountry={id => navigate('country', id)}
        canEdit={canEdit} disabled={busy} onUploadBusy={setBusy} onSaved={characterList.replace} />}
      {section === 'country' && country && <OriginalCountryEditor key={country.entityId} snapshot={country} adapter={countryAdapter}
        characters={characters} events={events} canEdit={canEdit} disabled={busy}
        onSaved={countryList.replace} onUploadBusy={setBusy} onNavigate={navigate} />}
      {section === 'event' && event && <OriginalEventEditor key={event.entityId} snapshot={event} adapter={eventAdapter}
        lookups={{ characters, countries, events }} canEdit={canEdit} disabled={busy}
        onSaved={eventList.replace} onUploadBusy={setBusy} onNavigate={navigate} />}
      {section === 'world' && note && <OriginalNoteEditor key={note.entityId} snapshot={note} adapter={noteAdapter}
        notes={notes} characters={characters} references={references} canEdit={canEdit} disabled={busy}
        onSaved={noteList.replace} onUploadBusy={setBusy} onNavigate={navigate}
        onCreateChild={() => createNote(note.entity.id)} />}
      {membersPanel !== undefined && <div hidden={section !== 'members'}>
        <div className="flex flex-col gap-4">{membersPanel}</div>
      </div>}
    </div>
  </div>
}

function OriginalCharacterEditor({ snapshot, adapter, characters, countries, countriesReady, notes, onNavigateRelation, onNavigateCountry, canEdit, disabled, onUploadBusy, onSaved }: {
  snapshot: OriginalCharacterSnapshot
  adapter: OriginalCharactersCloudAdapter
  characters: Character[]
  countries: Country[]
  countriesReady: boolean
  onNavigateCountry: (id: number) => void
  notes: WorldEntry[]
  onNavigateRelation: (kind: RelationTargetKind, id: number) => void
  canEdit: boolean
  disabled: boolean
  onUploadBusy: (busy: boolean) => void
  onSaved: (next: OriginalCharacterSnapshot) => void
}) {
  const baseline = useRef(snapshot)
  const docDirty = useRef(false)
  const bodyEditor = useRef<Editor | null>(null)
  const [bodyDraft, setBodyDraft] = useState<unknown>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { status, setActiveEntity } = useSaveStatus()
  const save = useCallback(async (_id: number, values: Partial<CharacterFormData>) => {
    try {
      const patch = editablePatch(baseline.current.character, values)
      if (docDirty.current && values.document !== undefined) {
        if (hasNewBodyImages(baseline.current.character.document, values.document)) {
          throw new Error('请使用正文的上传按钮添加图片')
        }
        patch.document = values.document
      }
      const next = await adapter.save(baseline.current, patch)
      baseline.current = next
      setSaveError(null)
      onSaved(next)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : '保存失败')
      throw cause
    }
  }, [adapter, onSaved])
  const form = useCharacterForm(snapshot.character, save, { localLookups: false, characters, countries, notes })
  const { handleDocReady, handleDocChange } = form
  useEffect(() => { docDirty.current = form.docDirty }, [form.docDirty])
  useEffect(() => { bodyEditor.current?.setEditable(canEdit && !disabled) }, [canEdit, disabled])
  const onEditorReady = useCallback((editor: Editor) => {
    bodyEditor.current = editor
    editor.setEditable(canEdit && !disabled)
    handleDocReady(editor)
  }, [canEdit, disabled, handleDocReady])
  const onBodyChange = useCallback(() => {
    handleDocChange()
    if (bodyEditor.current) setBodyDraft(bodyEditor.current.getJSON())
  }, [handleDocChange])

  const upload = useWorkspaceImageUpload(snapshot.workspaceId, canEdit && !disabled, onUploadBusy, setSaveError)

  async function uploadBodyImage(file: File) {
    const editor = bodyEditor.current
    if (editor) await upload(file, undefined, url => insertWorkspaceBodyImage(editor, url))
  }

  function uploadProfileImage(blob: Blob, type: 'header' | 'avatar' | 'gallery' | 'portrait') {
    return upload(blob, `${type}.png`)
  }

  useEffect(() => {
    setActiveEntity('character')
    return () => setActiveEntity(null)
  }, [setActiveEntity])
  useWorkspaceDraftGuard(form.dirty || form.saving || disabled, '角色')

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
            isMajor: form.isMajor, bio: form.bio, avatarUrl: form.avatarUrl,
            headerUrl: form.headerUrl, avatars: form.avatarUrls, gallery: form.galleryUrls,
            relatedCharacters: form.relatedCharacters, relatedNotes: form.relatedNotes,
            countryId: form.countryId ?? null, nationalityLegacy: form.nationalityLegacy,
            document: bodyDraft }, null, 2)} />
      </details>
    </div>}
    <fieldset disabled={!canEdit || disabled} className="flex min-w-0 flex-col gap-6">
      <ProfileBannerEditor headerUrl={form.headerUrl} avatarUrl={form.avatarUrl}
        onHeaderChange={canEdit && !disabled ? form.setHeaderUrl : undefined}
        onAvatarChange={canEdit && !disabled ? form.setAvatarUrl : undefined}
        onHeaderRemove={canEdit && !disabled ? () => form.setHeaderUrl('') : undefined}
        onAvatarRemove={canEdit && !disabled ? () => form.setAvatarUrl('') : undefined}
        saveImage={uploadProfileImage} />
      <label className="flex flex-col gap-2 text-ui text-ink-muted">角色名称
        <input value={form.name} onChange={event => form.setName(event.target.value)} className={TITLE_INPUT} />
      </label>
      <CharacterInfoSection form={form}
        fieldsOverride={countriesReady ? CLOUD_FIELDS : CLOUD_FIELDS.filter(field => field.type !== 'country')}
        onNavigateToCountry={onNavigateCountry} preserveLegacyNationality />
      <SummaryBlock value={form.bio} onChange={form.setBio} />
      <RelationsSection title="角色关系" selfName={form.name}
        rows={form.relationRows}
        inbound={form.inboundRelationRows}
        candidates={form.relationCandidates}
        onAdd={canEdit && !disabled ? form.addRelation : undefined}
        onRemove={canEdit && !disabled ? form.removeRelation : undefined}
        onRename={canEdit && !disabled ? form.renameRelation : undefined}
        onArrowChange={canEdit && !disabled ? form.setRelationArrow : undefined}
        onNavigate={onNavigateRelation} />
      <GalleryBlock title="立绘" images={form.avatarUrls} gridAspect="portrait" enableCrop cropAspect={9 / 16}
        onAdd={canEdit && !disabled ? path => form.setAvatarUrls(current => [...current, path]) : undefined}
        onReplace={canEdit && !disabled ? (index, path) => form.setAvatarUrls(current => current.map((url, i) => i === index ? path : url)) : undefined}
        onRemove={canEdit && !disabled ? index => form.setAvatarUrls(current => current.filter((_, i) => i !== index)) : undefined}
        saveImage={uploadProfileImage} />
      <GalleryBlock title="相册" images={form.galleryUrls}
        onAdd={canEdit && !disabled ? path => form.setGalleryUrls(current => [...current, path]) : undefined}
        onReplace={canEdit && !disabled ? (index, path) => form.setGalleryUrls(current => current.map((url, i) => i === index ? path : url)) : undefined}
        onRemove={canEdit && !disabled ? index => form.setGalleryUrls(current => current.filter((_, i) => i !== index)) : undefined}
        saveImage={uploadProfileImage} />
    </fieldset>
    <section className="border-t border-line pt-4">
      <h3 className="text-ui font-semibold">正文</h3>
      {canEdit && <label className={`${BTN_QUIET} cursor-pointer`}>
        上传正文图片
        <input type="file" aria-label="上传正文图片" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" disabled={disabled}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadBodyImage(file) }} />
      </label>}
      <EditorCore plain imageUploads={false} localReferences={false} content={snapshot.character.document ?? legacyBodySections([
        { content: snapshot.character.bio },
        { heading: '人物生平', content: snapshot.character.lifeStory },
      ]) ?? ''} onReady={onEditorReady} onContentChange={onBodyChange} />
    </section>
    <WorkspaceEntityHistory entityId={snapshot.entityId} version={snapshot.version} />
  </div>
}

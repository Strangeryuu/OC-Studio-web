'use client'

import { useEffect, useMemo, useState } from 'react'
import { Images, Menu, RefreshCw, Search } from 'lucide-react'
import { AlbumCard } from '@/components/shared/AlbumCard'
import { AlbumTreePanel } from '@/components/shared/AlbumTreePanel'
import { FullscreenViewer } from '@/components/shared/FullscreenViewer'
import { FilterSelect } from '@/components/shared/FilterSelect'
import { SortSelect } from '@/components/shared/SortViewControls'
import { ListEmptyState } from '@/components/shared/ListEmptyState'
import { PageToolbar } from '@/components/shared/PageToolbar'
import { CATEGORY_TREE, albumCategoryLabel, albumSourceLabel, albumSourceType,
  collectAlbumSources, matchesAlbumCategory } from '@/components/shared/album-utils'
import { ICON_BTN_MD } from '@/lib/ui-tokens'
import type { OriginalCharacterSnapshot } from '@/lib/cloud/adapters/original-characters'
import type { OriginalCountrySnapshot } from '@/lib/cloud/adapters/original-countries'
import type { OriginalEventSnapshot } from '@/lib/cloud/adapters/original-events'
import type { OriginalNoteSnapshot } from '@/lib/cloud/adapters/original-notes'
import type { CloudWorkspaceTag } from '@/lib/cloud/shared-tags'
import { cloudTableTagProjection, readCloudWorkspaceTags } from '@/features/tree-table/cloud/cloud-table-tags'
import { projectCloudAlbum } from './cloud-album-projection'

export interface WorkspaceAlbumProps {
  workspaceId: string
  worldName?: string
  characters: OriginalCharacterSnapshot[]
  countries: OriginalCountrySnapshot[]
  events: OriginalEventSnapshot[]
  notes: OriginalNoteSnapshot[]
  loading: boolean
  error?: string | null
  onNavigate: (kind: 'character' | 'event' | 'country' | 'world', id: number) => void
  onRefresh: () => Promise<void>
}

export function WorkspaceAlbum(props: WorkspaceAlbumProps) {
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState('all')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(CATEGORY_TREE.map(x => x.key)))
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [sourceFilter, setSourceFilter] = useState<number | 'all'>('all')
  const [tagFilter, setTagFilter] = useState<number | 'all'>('all')
  const [sortTime, setSortTime] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [tags, setTags] = useState<CloudWorkspaceTag[]>([])
  const [worldCover, setWorldCover] = useState('')
  const [tagRefresh, setTagRefresh] = useState(0)

  useEffect(() => {
    let active = true
    void fetch('/api/workspaces/' + props.workspaceId + '/tags', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('无法读取资料库标签')
        return readCloudWorkspaceTags(await response.json())
      })
      .then(rows => { if (active) setTags(rows) })
      .catch(() => { if (active) setTags([]) })
    return () => { active = false }
  }, [props.workspaceId, tagRefresh])

  useEffect(() => {
    let active = true
    void fetch('/api/workspaces/' + props.workspaceId + '/cover', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('无法读取世界封面')
        return response.json() as Promise<{ coverUrl?: string }>
      })
      .then(result => { if (active) setWorldCover(result.coverUrl ?? '') })
      .catch(() => { if (active) setWorldCover('') })
    return () => { active = false }
  }, [props.workspaceId, tagRefresh])

  const tagged = useMemo(() => cloudTableTagProjection(tags, [
    ...props.characters.map(row => row.character),
    ...props.countries.map(row => row.entity),
    ...props.events.map(row => row.entity),
    ...props.notes.map(row => row.entity),
  ]), [tags, props.characters, props.countries, props.events, props.notes])
  const entries = useMemo(() => projectCloudAlbum({
    characters: props.characters.map(row => tagged.decorate(row.character)),
    countries: props.countries.map(row => tagged.decorate(row.entity)),
    events: props.events.map(row => tagged.decorate(row.entity)),
    notes: props.notes.map(row => tagged.decorate(row.entity)),
    worldCoverUrl: worldCover, worldName: props.worldName,
  }), [props.characters, props.countries, props.events, props.notes, tagged, worldCover, props.worldName])

  const sourceType = albumSourceType(selectedKey)
  const sources = useMemo(() => sourceType ? collectAlbumSources(entries, sourceType) : [], [entries, sourceType])
  const selectedSource = sources.some(source => source.id === sourceFilter) ? sourceFilter : 'all'
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase()
    const rows = entries.filter(item =>
      matchesAlbumCategory(item, selectedKey) &&
      (!q || (item.sourceName + ' ' + albumCategoryLabel(item.category) +
        ' ' + tagged.tagName(item.tags)).toLocaleLowerCase().includes(q)) &&
      (tagFilter === 'all' || item.tags.includes(tagFilter)) &&
      (sourceType === null || selectedSource === 'all' || item.sourceId === selectedSource),
    )
    return sortTime ? rows.sort((a, b) => b.updatedAt - a.updatedAt) : rows
  }, [entries, search, selectedKey, tagged, tagFilter, sourceType, selectedSource, sortTime])
  const urls = useMemo(() => filtered.map(item => item.url), [filtered])

  const label = useMemo(() => {
    if (selectedKey === 'all') return '所有相册'
    for (const category of CATEGORY_TREE) {
      if (category.key === selectedKey) return category.label
      const sub = category.children.find(item => item.key === selectedKey)
      if (sub) return sub.label
    }
    return '所有相册'
  }, [selectedKey])

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    setProblem(null)
    setTagRefresh(value => value + 1)
    try { await props.onRefresh() }
    catch (cause) { setProblem(cause instanceof Error ? cause.message : '刷新失败') }
    finally { setRefreshing(false) }
  }
  const renderTree = (mobile: boolean) => <AlbumTreePanel entries={entries} selectedKey={selectedKey} expanded={expanded}
    onSelectKey={key => { setSelectedKey(key); setSourceFilter('all'); setViewerIndex(null); setDrawer(false) }}
    onToggleExpand={key => setExpanded(previous => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })}
    isMobile={mobile} refreshing={refreshing} onRefresh={() => void refresh()}
    onCloseMobileTree={() => setDrawer(false)} onCollapseTree={() => setCollapsed(true)} />

  function navigate(id: number, type: string) {
    if (type === 'worldEntry') props.onNavigate('world', id)
    else if (type === 'character' || type === 'country' || type === 'event') props.onNavigate(type, id)
  }

  return <section className="min-w-0 overflow-hidden rounded-panel border border-line">
    <div className="flex min-h-[28rem]">
      {!collapsed && <div className="hidden w-52 shrink-0 overflow-auto md:block">{renderTree(false)}</div>}
      {drawer && <div className="fixed inset-0 z-50 flex bg-black/30 md:hidden">
        <div className="h-full w-64 bg-paper">{renderTree(true)}</div>
        <button type="button" aria-label="关闭相册目录" className="flex-1" onClick={() => setDrawer(false)} />
      </div>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2 md:hidden">
          <button type="button" className={ICON_BTN_MD} aria-label="打开相册目录"
            onClick={() => setDrawer(true)}><Menu size={16}/></button>
          <input aria-label="移动端搜索相册" value={search} placeholder="搜索相册"
            onChange={event => { setSearch(event.target.value); setViewerIndex(null) }}
            className="min-w-0 flex-1 border-b border-line bg-transparent px-2 py-1 text-ui" />
          <SortSelect sortKey={sortTime ? 'time' : 'default'} onChange={key => setSortTime(key === 'time')}
            options={[{ value: 'default', label: '默认顺序' }, { value: 'time', label: '最近更新' }]} />
        </div>
        <PageToolbar title={label} leading={<button type="button" className={ICON_BTN_MD}
          aria-label="切换相册目录" onClick={() => {
            if (window.matchMedia('(min-width: 768px)').matches) setCollapsed(value => !value)
            else setDrawer(true)
          }}><Menu size={16}/></button>}
          actions={<>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input aria-label="搜索相册" placeholder="搜索..." value={search}
                onChange={event => { setSearch(event.target.value); setViewerIndex(null) }}
                className="h-8 w-36 bg-transparent pl-7 pr-2 text-ui text-ink" />
            </div>
            {sourceType && sources.length > 0 && <FilterSelect value={selectedSource}
              onChange={setSourceFilter}
              options={[{ value: 'all', label: '全部' + albumSourceLabel(sourceType) },
                ...sources.map(item => ({ value: item.id, label: item.name }))]}
              fallbackLabel="全部来源" triggerClassName="flex h-8 items-center gap-1 px-2 text-ui text-ink" />}
            <FilterSelect value={tagFilter} onChange={setTagFilter}
              options={[{ value: 'all', label: '全部标签' },
                ...[...tagged.tagsById.values()].map(item => ({ value: item.id, label: item.name }))]}
              fallbackLabel="全部标签" triggerClassName="flex h-8 items-center gap-1 px-2 text-ui text-ink" />
            <SortSelect sortKey={sortTime ? 'time' : 'default'} onChange={key => setSortTime(key === 'time')}
              options={[{ value: 'default', label: '默认顺序' }, { value: 'time', label: '最近更新' }]} />
            <button type="button" disabled={refreshing} className={ICON_BTN_MD} title="刷新"
              onClick={() => void refresh()}><RefreshCw size={15}/></button>
          </>} />
        {props.error && <p role="alert" className="px-4 text-ui text-error">{props.error}</p>}
        {problem && <p role="alert" className="px-4 text-ui text-error">{problem}</p>}
        <div className="min-h-[24rem] p-4">
          {props.loading ? <p className="py-12 text-center text-ui text-ink-muted">正在读取相册…</p>
            : filtered.length === 0 ? <ListEmptyState icon={Images} message="暂无图片" className="min-h-64" /> :
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {filtered.map((item, index) =>
                  <AlbumCard key={item.sourceType + ':' + item.sourceId + ':' + item.category + ':' + index}
                    entry={item} isMobile={false} onNavigate={item.sourceType === 'world' ? undefined : navigate}
                    onViewImage={() => setViewerIndex(index)} />)}
              </div>}
        </div>
      </div>
    </div>
    {viewerIndex !== null && <FullscreenViewer images={urls} initialIndex={viewerIndex}
      onClose={() => setViewerIndex(null)} />}
  </section>
}

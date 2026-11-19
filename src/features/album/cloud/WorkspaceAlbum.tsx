'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, ExternalLink, Eye, Images, Menu, RefreshCw, Search, Trash2, Replace } from 'lucide-react'
import { cloudMediaUrlId } from '@/lib/cloud/character-media'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { BTN_DANGER, BTN_PRIMARY, FIELD_INPUT } from '@/lib/ui-tokens'
import { AlbumCard } from '@/components/shared/AlbumCard'
import { MobileActionSheet, type ActionItem } from '@/components/shared/MobileActionSheet'
import { useMediaDownload } from '@/lib/use-media-download'
import { useDevice } from '@/lib/use-device'
import type { AlbumEntry } from '@/components/shared/useAlbumData'
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
  canManageMedia?: boolean
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
  const [mediaAction, setMediaAction] = useState<{mode:'delete'|'replace';entry:AlbumEntry}|null>(null)
  const [mediaPreview, setMediaPreview] = useState<{
    affected:{id:string;title:string;kind:string;version:number;references:number}[];
    coverVersion:number|null;references:number
  }|null>(null)
  const [mediaFile, setMediaFile] = useState<File|null>(null)
  const [mediaBusy, setMediaBusy] = useState(false)
  const [mediaError, setMediaError] = useState<string|null>(null)
  const { isMobile } = useDevice()
  const { save, saving } = useMediaDownload()
  const [actionSheet, setActionSheet] = useState<{open:boolean;title:string;actions:ActionItem[]}>(
    {open:false,title:'',actions:[]})

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

  function manageMedia(entry: AlbumEntry, mode: 'delete'|'replace') {
    if (!props.canManageMedia || !cloudMediaUrlId(entry.url)) return
    setMediaAction({entry, mode})
    setMediaPreview(null)
    setMediaFile(null)
    setMediaError(null)
  }
  useEffect(() => {
    if (!mediaAction) return
    const id = cloudMediaUrlId(mediaAction.entry.url)
    if (!id) return
    let active = true
    void fetch('/api/workspaces/' + props.workspaceId + '/media/' + id, { cache:'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('图片引用信息读取失败，请刷新重试')
        return response.json() as Promise<NonNullable<typeof mediaPreview>>
      })
      .then(result => { if (active) setMediaPreview(result) })
      .catch(cause => { if (active) setMediaError(cause instanceof Error ? cause.message : '读取失败') })
    return () => { active = false }
  }, [mediaAction, props.workspaceId])

  async function confirmMediaAction() {
    if (!mediaAction || !mediaPreview || mediaBusy || !props.canManageMedia) return
    if (mediaAction.mode === 'replace' && !mediaFile) {
      setMediaError('请先选择替换图片')
      return
    }
    const assetId = cloudMediaUrlId(mediaAction.entry.url)
    if (!assetId) return
    setMediaBusy(true)
    setMediaError(null)
    try {
      let replaceWith: string | undefined
      if (mediaAction.mode === 'replace' && mediaFile) {
        const form = new FormData()
        form.append('file', mediaFile)
        const uploaded = await fetch('/api/workspaces/' + props.workspaceId + '/media', {
          method:'POST', body:form,
        })
        const result: {asset?:{id?:string};error?:string} = await uploaded.json().catch(() => ({}))
        if (!uploaded.ok || !result.asset?.id) throw new Error('上传替换图片失败：' + (result.error ?? uploaded.status))
        replaceWith = result.asset.id
      }
      const response = await fetch('/api/workspaces/' + props.workspaceId + '/media/' + assetId, {
        method:mediaAction.mode === 'replace' ? 'PATCH' : 'DELETE',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          confirmEverywhere:true,
          expectedVersions:Object.fromEntries(mediaPreview.affected.map(item => [item.id,item.version])),
          coverVersion:mediaPreview.coverVersion,
          ...(replaceWith ? {replaceWith} : {}),
        }),
      })
      const result: {error?:string} = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error === 'VERSION_CONFLICT'
        ? '词条版本已被其他成员更新，请刷新后重新确认'
        : '图片操作失败：' + (result.error ?? response.status))
      setMediaAction(null)
      setViewerIndex(null)
      setTagRefresh(value => value + 1)
      await props.onRefresh()
    } catch (cause) {
      setMediaError(cause instanceof Error ? cause.message : '网络异常，请刷新核对操作结果')
    } finally { setMediaBusy(false) }
  }

  function openActionSheet(entry: AlbumEntry, index: number) {
    const actions: ActionItem[] = [
      { id: 'view', label: '查看大图', icon: <Eye size={20}/>,
        onPress: () => setViewerIndex(index) },
      { id: 'save', label: saving ? '保存中…' : '保存到…',
        icon: <Download size={20}/>,
        onPress: () => { void save(entry.url, entry.sourceName) } },
    ]
    if (props.canManageMedia && cloudMediaUrlId(entry.url)) {
      actions.push({ id:'replace', label:'替换图片（全部引用）',icon:<Replace size={20}/>,
        onPress:() => manageMedia(entry,'replace') })
      actions.push({ id:'delete', label:'删除图片（全部引用）',icon:<Trash2 size={20}/>,
        onPress:() => manageMedia(entry,'delete') })
    }
    if (entry.sourceType !== 'world') actions.push({
      id: 'navigate', label: '跳转到来源', icon: <ExternalLink size={20}/>,
      onPress: () => navigate(entry.sourceId, entry.sourceType),
    })
    setActionSheet({open:true,title:entry.sourceName,actions})
  }

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
          {sourceType && sources.length > 0 && <FilterSelect value={selectedSource}
            onChange={setSourceFilter}
            options={[{ value: 'all', label: '全部来源' },
              ...sources.map(item => ({value:item.id,label:item.name}))]}
            fallbackLabel="全部来源" triggerClassName="flex h-8 items-center gap-1 px-2 text-ui text-ink" />}
          <FilterSelect value={tagFilter} onChange={setTagFilter}
            options={[{ value: 'all', label: '全部标签' },
              ...[...tagged.tagsById.values()].map(item => ({value:item.id,label:item.name}))]}
            fallbackLabel="全部标签" triggerClassName="flex h-8 items-center gap-1 px-2 text-ui text-ink" />
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
                    entry={item} isMobile={isMobile} onNavigate={item.sourceType === 'world' ? undefined : navigate}
                    onLongPress={() => openActionSheet(item,index)}
                    onViewImage={() => setViewerIndex(index)}
                    onReplace={props.canManageMedia ? () => manageMedia(item,'replace') : undefined}
                    onDelete={props.canManageMedia ? () => manageMedia(item,'delete') : undefined} />)}
              </div>}
        </div>
      </div>
    </div>
    {viewerIndex !== null && <FullscreenViewer images={urls} initialIndex={viewerIndex}
      onClose={() => setViewerIndex(null)} />}
    <MobileActionSheet open={actionSheet.open}
      onClose={() => setActionSheet(prev => ({...prev,open:false}))}
      title={actionSheet.title} actions={actionSheet.actions} />
    <AlertDialog open={mediaAction !== null} onOpenChange={open => {
      if (!open && !mediaBusy) { setMediaAction(null); setMediaPreview(null) }
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{mediaAction?.mode === 'replace' ? '替换全局图片' : '删除全局图片'}</AlertDialogTitle>
          <AlertDialogDescription>
            {mediaAction?.mode === 'replace' ? '替换' : '删除'}后将同时更新本世界观中
            其他词条、正文、相册、封面及地图中的同一张图片引用，并记录修改历史。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {mediaPreview ? <div className="space-y-2 text-ui">
          <p>涉及 <strong>{mediaPreview.affected.length} 个词条</strong>、
            <strong>{mediaPreview.references} 处图片引用</strong>
            {mediaPreview.coverVersion !== null ? '，包含世界观封面' : ''}。</p>
          {mediaPreview.affected.length > 0 && <p className="max-h-28 overflow-y-auto text-caption text-ink-muted">
            关联词条：{mediaPreview.affected.slice(0,20).map(item => item.title).join('、')}
            {mediaPreview.affected.length > 20 ? ' 等' : ''}
          </p>}
        </div> : <p className="text-caption text-ink-muted">正在核对图片引用…</p>}
        {mediaAction?.mode === 'replace' && <label className="flex flex-col gap-2 text-ui">
          新图片
          <input type="file" aria-label="选择替换图片"
            accept="image/png,image/jpeg,image/webp,image/gif" disabled={mediaBusy}
            className={FIELD_INPUT}
            onChange={event => setMediaFile(event.target.files?.[0] ?? null)} />
        </label>}
        {mediaError && <p role="alert" className="text-ui text-error">{mediaError}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mediaBusy}>取消</AlertDialogCancel>
          <button type="button" disabled={!mediaPreview || mediaBusy ||
            (mediaAction?.mode === 'replace' && !mediaFile)}
            className={mediaAction?.mode === 'replace' ? BTN_PRIMARY : BTN_DANGER}
            onClick={() => void confirmMediaAction()}>
            {mediaBusy ? '同步中…' : mediaAction?.mode === 'replace' ? '确认替换全部引用' : '确认删除全部引用'}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
}

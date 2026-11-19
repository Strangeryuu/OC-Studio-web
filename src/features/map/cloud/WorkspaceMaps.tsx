'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MapCanvas, type AnnotationDraft } from '@/features/map/components/MapCanvas'
import { MapSwitcher } from '@/features/map/components/MapSwitcher'
import { AnnotationColorMenu } from '@/features/map/components/AnnotationColorMenu'
import { MediaContextMenu } from '@/components/shared/MediaContextMenu'
import { Palette, Trash2, PenLine, Route } from 'lucide-react'
import { MAP_VIEWS, type MapViewRenderer } from '@/features/map/save-generated'
import { renderMapView } from '@/features/map/render-view'
import { archiveFileName, archiveImageToBlob, blobToArchiveImage, parseMapArchive,
  scaleAnnotations, serializeMapArchive, type MapArchive } from '@/features/map/archive'
import { saveBlobAs, exportMapImage } from '@/features/map/export'
import type { MapView, WorldMapParams } from '@/plugins/map-generator'
import { useMapViewport } from '@/features/map/hooks/useMapViewport'
import { DEFAULT_MAP_LAYERS, MAP_LAYER_LABELS, type MapAnchor, type MapLayerKind } from '@/features/map/types'
import { annotationAt, ANNOTATION_LABELS, minPoints, newAnnotationId, parseAnnotations, stringifyAnnotations, type MapAnnotation } from '@/features/map/annotations'
import type { AnchorKind, AnchorPoint, MapEntity } from '@/features/map/services'
import { MAP_CATEGORY, isCodexEntry, isMapEntry } from '@/lib/entry-kinds'
import { normalizeMapAnchor } from '@/lib/cloud/map-fields'
import { newWorldEntryData } from '@/lib/entity-defaults'
import { buildDefaultEntry } from '@/features/world/services'
import type { OriginalNoteSnapshot, OriginalNotePatch, OriginalNotesCloudAdapter } from '@/lib/cloud/adapters/original-notes'
import type { OriginalCountrySnapshot, OriginalCountriesCloudAdapter } from '@/lib/cloud/adapters/original-countries'
import type { OriginalEventSnapshot, OriginalEventsCloudAdapter } from '@/lib/cloud/adapters/original-events'
import { WorkspaceEntityHistory } from '@/components/cloud/WorkspaceEntityHistory'
import { useWorkspaceDraftGuard, useWorkspaceImageUpload } from '@/components/cloud/workspace-editor-guards'
import { registerPendingSave } from '@/lib/pending-saves'
import { BTN_PRIMARY, BTN_QUIET } from '@/lib/ui-tokens'

const MapGeneratorPanel = dynamic(
  () => import('@/features/map/MapGeneratorPanel').then(module => module.MapGeneratorPanel),
  { ssr: false },
)

type CloudMap = MapEntity & { mapViews?: Record<string, string> }
type PinKind = AnchorKind
type PinRecord = { kind: PinKind; id: number; title: string; position: MapAnchor | null; mapId: string | null }
type NavigationKind = 'country' | 'event' | 'world'
type Props = {
  workspaceId: string
  rows: OriginalNoteSnapshot[]
  countries: OriginalCountrySnapshot[]
  events: OriginalEventSnapshot[]
  noteAdapter: OriginalNotesCloudAdapter
  countryAdapter: OriginalCountriesCloudAdapter
  eventAdapter: OriginalEventsCloudAdapter
  onMapCreated: (row: OriginalNoteSnapshot) => void
  onMapSaved: (row: OriginalNoteSnapshot) => void
  onCountrySaved: (row: OriginalCountrySnapshot) => void
  onEventSaved: (row: OriginalEventSnapshot) => void
  onReconciled: () => Promise<void>
  onNavigate: (kind: NavigationKind, id: number) => void
  canEdit: boolean
  canDelete: boolean
  disabled: boolean
  loading: boolean
  error?: string | null
}

function toMap(row: OriginalNoteSnapshot): CloudMap {
  const entity = row.entity
  return {
    id: entity.id, name: entity.title, image: entity.mapImage,
    width: entity.mapWidth, height: entity.mapHeight,
    seed: entity.mapSeed, params: entity.mapParams,
    mode: entity.mapMode, annotations: entity.mapAnnotations,
    mapViews: entity.mapViews ?? undefined,
    updatedAt: entity.updatedAt,
  }
}

function makePins(countries: Props['countries'], events: Props['events'], notes: Props['rows']): PinRecord[] {
  return [
    ...countries.map(row => ({ kind: 'country' as const, id: row.entity.id, title: row.entity.name,
      position: normalizeMapAnchor(row.entity.mapPosition), mapId: row.entity.mapId ?? null })),
    ...events.map(row => ({ kind: 'event' as const, id: row.entity.id, title: row.entity.title,
      position: normalizeMapAnchor(row.entity.mapPosition), mapId: row.entity.mapId ?? null })),
    ...notes.filter(row => isCodexEntry(row.entity)).map(row => ({ kind: 'worldEntry' as const,
      id: row.entity.id, title: row.entity.title, position: normalizeMapAnchor(row.entity.mapPosition),
      mapId: row.entity.mapId ?? null })),
  ]
}

function mapKey(kind: PinKind, id: number): string {
  return kind + ':' + id
}

/** Cloud data replaces the Dexie/vault services while preserving the original map canvas. */
export function WorkspaceMaps(props: Props) {
  const { rows, countries, events, noteAdapter, countryAdapter, eventAdapter, canEdit, disabled } = props
  const maps = useMemo(() => rows.filter(row => isMapEntry(row.entity)), [rows])
  const [activeId, setActiveId] = useState<number | null>(null)
  const selected = maps.find(row => row.entity.id === activeId) ?? maps[0] ?? null
  const map = selected ? toMap(selected) : null
  const [name, setName] = useState('')
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [generatorOpen, setGeneratorOpen] = useState(false)
  const [generatorBusy, setGeneratorBusy] = useState(false)
  const [archiveWarning, setArchiveWarning] = useState<string | null>(null)
  const [edit, setEdit] = useState(false)
  const [shownLayers, setShownLayers] = useState<MapLayerKind[]>(DEFAULT_MAP_LAYERS.map(item => item.kind))
  const [draft, setDraft] = useState<AnnotationDraft | null>(null)
  const [draftAnchor, setDraftAnchor] = useState<{ key: string; anchor: MapAnchor } | null>(null)
  const [pick, setPick] = useState('')
  const [removeId, setRemoveId] = useState('')
  const [canvasMenu, setCanvasMenu] = useState<{
    at: { x: number; y: number }; anchor: MapAnchor; target: MapAnnotation | null
  } | null>(null)
  const [paintMenu, setPaintMenu] = useState<{ target: MapAnnotation; at: { x: number; y: number } } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [failedDraft, setFailedDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const archiveRef = useRef<HTMLInputElement | null>(null)
  const writing = useRef<Promise<void> | null>(null)
  const viewport = useMapViewport(map?.width && map?.height ? map.width / map.height : 16 / 9, map?.id ?? 0)
  const pins = useMemo(() => makePins(countries, events, rows), [countries, events, rows])
  const activeName = map?.name ?? ''
  const shown = useMemo<AnchorPoint[]>(() => pins.filter(pin => pin.position && pin.mapId === activeName && shownLayers.includes(pin.kind))
    .map(pin => ({ kind: pin.kind, id: pin.id, title: pin.title,
      anchor: draftAnchor?.key === mapKey(pin.kind, pin.id) ? draftAnchor.anchor : pin.position!,
      mapId: activeName })), [pins, activeName, shownLayers, draftAnchor])
  const annotations = useMemo(() => parseAnnotations(map?.annotations), [map?.annotations])
  const canModify = canEdit && !disabled && !saving

  useEffect(() => registerPendingSave(() => {
    if (generatorBusy && writing.current === null) throw new Error('地图生成结果仍在处理中')
    if (draft !== null) throw new Error('地图有尚未完成的标注，请先完成或取消')
    if (failedDraft !== null) throw new Error('地图上次保存失败，未保存的数据仍保留在页面中')
    return writing.current ?? undefined
  }), [draft, failedDraft, generatorBusy])
  useWorkspaceDraftGuard(draft !== null || saving || generatorBusy || failedDraft !== null, '地图')

  // The surrounding operation owns the save lock; the upload helper only reports failures.
  const upload = useWorkspaceImageUpload(props.workspaceId, canEdit && !disabled,
    () => {}, setError)

  async function execute(job: () => Promise<void>, unsaved?: unknown, propagate = false): Promise<boolean> {
    if (writing.current || disabled || !canEdit) return false
    setError(null)
    setFailedDraft(null)
    setSaving(true)
    const task = job()
    writing.current = task
    try {
      await task
      setDraftAnchor(null)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存地图失败')
      setFailedDraft(JSON.stringify(unsaved ?? { map: activeName, draft }, null, 2))
      if (propagate) throw cause
      return false
    } finally {
      writing.current = null
      setSaving(false)
    }
  }

  function updateMap(patch: OriginalNotePatch) {
    if (!selected) return
    void execute(async () => {
      props.onMapSaved(await noteAdapter.save(selected, patch))
    }, patch)
  }

  function updatePin(kind: PinKind, id: number, position: MapAnchor | null) {
    if (!map) return
    const patch = { mapPosition: position, mapId: position ? map.name : null }
    setDraftAnchor(position ? { key: mapKey(kind, id), anchor: position } : null)
    void execute(async () => {
      if (kind === 'country') {
        const current = countries.find(row => row.entity.id === id)
        if (!current) throw new Error('国家条目已变更，请刷新')
        props.onCountrySaved(await countryAdapter.save(current, patch))
      } else if (kind === 'event') {
        const current = events.find(row => row.entity.id === id)
        if (!current) throw new Error('事件条目已变更，请刷新')
        props.onEventSaved(await eventAdapter.save(current, patch))
      } else {
        const current = rows.find(row => row.entity.id === id && isCodexEntry(row.entity))
        if (!current) throw new Error('词条已变更，请刷新')
        props.onMapSaved(await noteAdapter.save(current, patch))
      }
    }, { kind, id, ...patch })
  }

  async function persistAnnotations(items: readonly MapAnnotation[]): Promise<boolean> {
    if (!selected) return false
    const patch = { mapAnnotations: stringifyAnnotations(items) ?? null }
    return execute(async () => {
      props.onMapSaved(await noteAdapter.save(selected, patch))
    }, patch)
  }

  async function finishAnnotation() {
    if (!draft || !map || draft.points.length < minPoints(draft.kind)) return
    const annotation = { id: newAnnotationId(), kind: draft.kind, points: draft.points }
    if (await persistAnnotations([...annotations, annotation])) setDraft(null)
  }

  function startDraft(kind: 'border' | 'road', origin?: MapAnchor) {
    setCanvasMenu(null)
    setDraft({ kind, points: origin ? [origin] : [] })
  }

  async function changeAnnotation(target: MapAnnotation, patch: Partial<Pick<MapAnnotation, 'color' | 'fill'>>) {
    setPaintMenu(null)
    const updated = annotations.map(item => item.id === target.id ? { ...item, ...patch } : item)
    await persistAnnotations(updated)
  }

  useEffect(() => {
    if (draft === null) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDraft(null)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [draft])

  function removeAnnotation() {
    if (!removeId) return
    updateMap({ mapAnnotations: stringifyAnnotations(annotations.filter(item => item.id !== removeId)) ?? null })
    setRemoveId('')
  }

  async function manageMap(method: 'PATCH' | 'DELETE', id: number, nextName?: string) {
    const target = maps.find(row => row.entity.id === id)
    if (!target || (method === 'DELETE' && !props.canDelete) || (method === 'PATCH' && !canEdit)) return
    if (draft !== null) {
      setError('请先完成或取消当前标注')
      return
    }
    await execute(async () => {
      const response = await fetch(
        `/api/workspaces/${props.workspaceId}/maps/${target.entityId}`,
        { method, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedVersion: target.version, ...(nextName ? { name: nextName } : {}) }) },
      )
      if (!response.ok) {
        const result: { error?: string } = await response.json().catch(() => ({}))
        throw new Error(result.error === 'VERSION_CONFLICT'
          ? '地图已由其他成员修改，请刷新后重试'
          : result.error === 'MAP_NAME_TAKEN' ? '当前资料库已有同名地图'
            : '地图管理操作失败：' + (result.error ?? response.status))
      }
      await props.onReconciled()
      if (method === 'DELETE') setActiveId(null)
      setSwitcherOpen(false)
    }, { method, mapId: id, name: nextName })
  }

  async function createMap() {
    const title = name.trim()
    if (!title || maps.some(row => row.entity.title === title)) {
      setError('请输入未被使用的地图名称')
      return
    }
    await execute(async () => {
      const entry = buildDefaultEntry({ ...newWorldEntryData(), title, category: MAP_CATEGORY })
      const created = await noteAdapter.create(entry)
      props.onMapCreated(created)
      setActiveId(created.entity.id)
      setName('')
      setDraft(null)
    }, { title })
  }

  async function uploadMapImage(blob: Blob, fileName: string): Promise<string> {
    const url = await upload(blob, fileName)
    if (!url) throw new Error('底图上传失败，请检查网络和图片格式')
    return url
  }

  async function generateBackground(
    blob: Blob, size: { width: number; height: number },
    seed: number, params: WorldMapParams, view: MapView,
    onProgress?: (stage: string, value: number) => void,
    renderView?: MapViewRenderer,
  ) {
    if (!selected || writing.current || disabled || !canEdit) throw new Error('当前地图仍在保存，请稍后重试')
    await execute(async () => {
      const views: Record<string, string> = {}
      views[view] = await uploadMapImage(blob, `${selected.entity.title}-${view}.png`)
      const other = MAP_VIEWS.filter(item => item !== view)
      if (renderView) {
        for (let index = 0; index < other.length; index += 1) {
          const next = other[index]
          onProgress?.('渲染' + next, (index + 1) / (other.length + 1))
          try {
            const image = await renderView(next)
            views[next] = await uploadMapImage(image, `${selected.entity.title}-${next}.png`)
          } catch (cause) {
            console.warn('[cloud map] Optional view rendering failed', next, cause)
          }
        }
      }
      const saved = await noteAdapter.save(selected, {
        mapImage: views[view], mapWidth: size.width, mapHeight: size.height,
        mapSeed: seed, mapParams: JSON.stringify(params), mapMode: view, mapViews: views,
      })
      props.onMapSaved(saved)
      setGeneratorOpen(false)
      onProgress?.('', 1)
    }, { map: selected.entity.title, seed, view, params }, true)
  }

  async function switchGeneratedView(view: MapView) {
    if (!selected || !map || !canModify) return
    const cached = map.mapViews?.[view]
    if (cached) {
      updateMap({ mapImage: cached, mapMode: view })
      return
    }
    if (map.seed === undefined || !map.params) return
    await execute(async () => {
      const params = JSON.parse(map.params!) as WorldMapParams
      const png = await renderMapView({ seed: map.seed!, params, view })
      const url = await uploadMapImage(png, `${map.name}-${view}.png`)
      const saved = await noteAdapter.save(selected, {
        mapImage: url, mapMode: view, mapViews: { ...map.mapViews, [view]: url },
      })
      props.onMapSaved(saved)
    }, { map: map.name, view })
  }

  async function exportArchive() {
    if (!map || !canEdit || saving) return
    setSaving(true)
    setError(null)
    try {
      const image = map.image ? await (async () => {
        const response = await fetch(map.image!, { cache: 'no-store' })
        if (!response.ok) throw new Error('无法读取此地图的私有底图')
        return blobToArchiveImage(await response.blob())
      })() : undefined
      let params: Record<string, unknown> | undefined
      if (map.params) {
        try {
          const value: unknown = JSON.parse(map.params)
          if (value && typeof value === 'object' && !Array.isArray(value)) params = value as Record<string, unknown>
        } catch { /* Older unparseable snapshots have no reusable params. */ }
      }
      const archive: MapArchive = {
        name: map.name, seed: map.seed, params,
        view: map.mode, width: map.width, height: map.height,
        annotations, image,
      }
      await saveBlobAs(new Blob([serializeMapArchive(archive)], { type: 'application/json' }),
        archiveFileName(map.name), { filterName: '地图档案' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出地图失败')
    } finally { setSaving(false) }
  }

  async function exportImage() {
    if (!map?.image || !canEdit || saving) return
    setSaving(true)
    setError(null)
    try {
      const anchors = pins.filter(pin => pin.position && pin.mapId === map.name)
        .map(pin => ({ title: pin.title, kind: pin.kind,
          x: pin.position!.x, y: pin.position!.y }))
      await exportMapImage({ image: map.image, width: map.width, height: map.height },
        anchors, { annotations, fileName: map.name.replace(/[\\/:*?"<>|]+/g, '-') + '.png' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '地图图片导出失败')
    } finally { setSaving(false) }
  }

  async function importArchive(file: File | undefined) {
    if (!file || !canEdit || saving || disabled) return
    if (file.size > 20 * 1024 * 1024) { setError('地图档案超过 20 MB'); return }
    await execute(async () => {
      const { archive, coordinateSpace, warnings } = parseMapArchive(await file.text())
      let title = archive.name.trim().slice(0, 190) || '导入地图'
      const occupied = new Set(maps.map(row => row.entity.title))
      if (occupied.has(title)) {
        const base = title.slice(0, 175)
        let number = 2
        while (occupied.has(`${base} ${number}`)) number += 1
        title = `${base} ${number}`
      }

      let imageUrl: string | undefined
      let width = archive.width
      let height = archive.height
      if (archive.image) {
        const image = archiveImageToBlob(archive.image)
        const bitmap = await createImageBitmap(image)
        width = bitmap.width
        height = bitmap.height
        bitmap.close()
        imageUrl = await uploadMapImage(image, title + '.png')
      }

      let annotationItems = archive.annotations
      if (coordinateSpace === 'pixel' && annotationItems.length) {
        if (width && height) annotationItems = scaleAnnotations(annotationItems, width, height)
        else {
          annotationItems = []
          warnings.push('缺少底图尺寸，已跳过像素坐标标注')
        }
      }
      const view = MAP_VIEWS.find(candidate => candidate === archive.view)
      const entry = buildDefaultEntry({ ...newWorldEntryData(), title, category: MAP_CATEGORY }, {
        mapImage: imageUrl, mapWidth: width, mapHeight: height,
        mapSeed: archive.seed, mapParams: archive.params ? JSON.stringify(archive.params) : undefined,
        mapMode: view, mapViews: imageUrl && view ? { [view]: imageUrl } : undefined,
        mapAnnotations: stringifyAnnotations(annotationItems),
      })
      const created = await noteAdapter.create(entry)
      props.onMapCreated(created)
      setActiveId(created.entity.id)
      setArchiveWarning(warnings.length ? warnings.join('；') : null)
      setSwitcherOpen(false)
    }, { importedFile: file.name }, true).catch(() => undefined)
  }

  async function setBackground(file: File | undefined) {
    if (!file || !selected || !canModify) return
    setError(null)
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      setError('无法识别底图尺寸，请选择 PNG、JPEG 或 WebP 图片')
      return
    }
    const width = bitmap.width
    const height = bitmap.height
    bitmap.close()
    await execute(async () => {
      const url = await uploadMapImage(file, file.name)
      const saved = await noteAdapter.save(selected, {
        mapImage: url, mapWidth: width, mapHeight: height,
        mapSeed: null, mapParams: null, mapMode: null, mapViews: null,
      })
      props.onMapSaved(saved)
    }, { file: file.name, width, height })
  }

  return <section className="flex min-w-0 flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
      <h2 className="mr-2 text-reading font-semibold">地图</h2>
      {maps.length > 0 && <div className="relative">
        <button type="button" aria-expanded={switcherOpen} aria-label="选择地图"
          disabled={saving || draft !== null || generatorOpen || failedDraft !== null}
          className={BTN_QUIET} onClick={() => setSwitcherOpen(value => !value)}>
          {map?.name ?? '选择地图'} · 切换
        </button>
        {switcherOpen && <div className="absolute left-0 top-full z-40 mt-1 w-[320px] max-w-[calc(100vw-32px)]">
          <MapSwitcher maps={maps.map(toMap)} activeId={map?.id ?? null}
            anchorCount={item => pins.filter(pin => pin.mapId === item.name && pin.position).length}
            canRename={canEdit} canDelete={props.canDelete} canCreate={canEdit} allowDeleteLast
            onSelect={id => { setActiveId(id); setDraftAnchor(null); setCanvasMenu(null); setPaintMenu(null); setSwitcherOpen(false); setShowDetails(false); setError(null) }}
            onRename={(id, title) => void manageMap('PATCH', id, title)}
            onDelete={id => void manageMap('DELETE', id)}
            onCreate={() => { setSwitcherOpen(false); document.getElementById('new-map-name')?.focus() }}
            onOpenDetail={() => { setShowDetails(true); setSwitcherOpen(false) }} />
        </div>}
      </div>}
      {canEdit && <><input ref={archiveRef} type="file" accept=".ocmap,application/json"
        aria-label="导入地图档案" className="sr-only" disabled={!canModify}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importArchive(file) }} />
        <button type="button" className={BTN_QUIET} disabled={!canModify}
          onClick={() => archiveRef.current?.click()}>导入 .ocmap</button>
        <input id="new-map-name" aria-label="新地图名称" placeholder="新地图名称" value={name}
        onChange={event => setName(event.target.value)} disabled={disabled || saving || failedDraft !== null}
        className="min-w-0 w-36 rounded-control border border-line bg-transparent px-2 py-1 text-ui" />
        <button className={BTN_QUIET} type="button" onClick={() => void createMap()}
          disabled={!name.trim() || disabled || saving || failedDraft !== null}>新建地图</button></>}
      {map && canEdit && <button type="button" className={BTN_QUIET}
        disabled={disabled || saving || draft !== null} onClick={() => setEdit(value => !value)}>
        {edit ? '完成编辑' : '编辑地图'}
      </button>}
    </div>
    {props.loading && <p className="text-ui text-ink-muted">正在读取地图…</p>}
    {props.error && <p role="alert" className="text-ui text-error">{props.error}</p>}
    {archiveWarning && <p role="status" className="text-ui text-ink-muted">{archiveWarning}</p>}
    {error && <div role="alert" className="text-ui text-error">{error}
      {failedDraft && <>
        <details><summary>复制未保存数据</summary><textarea readOnly className="w-full" value={failedDraft}/></details>
        <button type="button" className={BTN_QUIET} onClick={() => {
          if (window.confirm('确认放弃此次未保存的地图修改？')) {
            setFailedDraft(null); setDraftAnchor(null); setError(null)
          }
        }}>放弃未保存修改</button>
      </>}
    </div>}
    {map && <>
      {showDetails && <div className="rounded-panel border border-line p-3 text-ui">
        <div className="flex items-center justify-between gap-3">
          <strong>{map.name}</strong>
          <button type="button" className={BTN_QUIET} onClick={() => setShowDetails(false)}>关闭详情</button>
        </div>
        <p>尺寸：{map.width ?? '—'} × {map.height ?? '—'} · 标注 {annotations.length} 条 ·
          锚点 {pins.filter(pin => pin.mapId === map.name && pin.position).length} 个</p>
      </div>}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
        aria-label="上传地图底图" disabled={!canModify}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void setBackground(file) }} />
      {canEdit && <div className="flex flex-wrap items-center gap-2 text-ui">
        <button type="button" className={BTN_QUIET} disabled={saving}
          onClick={() => void exportArchive()}>导出 .ocmap</button>
        <button type="button" className={BTN_QUIET} disabled={saving || !map.image}
          onClick={() => void exportImage()}>导出 PNG（含锚点）</button>
        <button type="button" className={BTN_QUIET} disabled={!canModify || generatorBusy || draft !== null}
          onClick={() => setGeneratorOpen(current => !current)}>{generatorOpen ? '返回地图' : '地图生成器'}</button>
      </div>}
      {edit && canEdit && !generatorOpen && <div className="flex flex-wrap items-center gap-2 text-ui">
        <button type="button" className={BTN_QUIET} onClick={() => fileRef.current?.click()}
          disabled={!canModify}>{map.image ? '替换底图' : '上传底图'}</button>
        {map.image && <button type="button" className={BTN_QUIET} disabled={!canModify}
          onClick={() => {
            if (window.confirm('确认移除当前地图底图？地图锚点和标注会保留，其他引用图片仍保留。'))
              updateMap({mapImage:null,mapViews:null,mapMode:null})
          }}>删除底图</button>}
        <label>添加锚点 <select aria-label="选择要标注的条目" value={pick} disabled={!canModify}
          onChange={event => setPick(event.target.value)} className="rounded-control border border-line bg-paper px-2 py-1">
          <option value="">选择条目</option>
          {pins.filter(pin => pin.mapId !== activeName).map(pin => <option key={mapKey(pin.kind,pin.id)}
            value={mapKey(pin.kind,pin.id)}>{MAP_LAYER_LABELS[pin.kind]}：{pin.title}</option>)}
        </select></label>
        <button type="button" className={BTN_QUIET} disabled={!canModify || !pick}
          onClick={() => { const pin = pins.find(item => mapKey(item.kind,item.id) === pick)
            if (pin) updatePin(pin.kind, pin.id, { x: 0.5, y: 0.5 }); setPick('') }}>放置中心</button>
        <button type="button" className={BTN_QUIET} disabled={!canModify || draft !== null}
          onClick={() => startDraft('border')}>绘制国界</button>
        <button type="button" className={BTN_QUIET} disabled={!canModify || draft !== null}
          onClick={() => startDraft('road')}>绘制道路</button>
        <select aria-label="选择要删除的地图标注" value={removeId} disabled={!canModify}
          onChange={event => setRemoveId(event.target.value)} className="rounded-control border border-line bg-paper px-2 py-1">
          <option value="">选择标注</option>
          {annotations.map(item => <option key={item.id} value={item.id}>
            {item.kind === 'border' ? '国界' : '道路'} · {item.points.length} 点</option>)}
        </select>
        <button type="button" className={BTN_QUIET} disabled={!canModify || !removeId}
          onClick={removeAnnotation}>删除标注</button>
      </div>}
      <div className="flex flex-wrap items-center gap-2 text-ui">
        {DEFAULT_MAP_LAYERS.map(layer => <label key={layer.kind} className="flex items-center gap-1">
          <input type="checkbox" checked={shownLayers.includes(layer.kind)}
            onChange={event => setShownLayers(current => event.target.checked ? [...current,layer.kind]
              : current.filter(item => item !== layer.kind))} />{MAP_LAYER_LABELS[layer.kind]}
        </label>)}
        <button type="button" className={BTN_QUIET} onClick={viewport.zoomOut}>缩小</button>
        <button type="button" className={BTN_QUIET} onClick={viewport.reset}>复位</button>
        <button type="button" className={BTN_QUIET} onClick={viewport.zoomIn}>放大</button>
        {saving && <span aria-live="polite">正在保存…</span>}
      </div>
      {draft && <div className="flex flex-wrap items-center gap-2 text-ui">
        <span>正在绘制{draft.kind === 'border' ? '国界' : '道路'}：{draft.points.length} 个点</span>
        <button type="button" className={BTN_PRIMARY}
          disabled={saving || draft.points.length < minPoints(draft.kind)} onClick={() => void finishAnnotation()}>完成标注</button>
        <button type="button" className={BTN_QUIET} onClick={() => setDraft(null)}>取消绘制</button>
      </div>}
      {map.seed !== undefined && map.params && !generatorOpen && <div className="flex flex-wrap items-center gap-2 text-ui">
        <span>生成视图</span>
        {MAP_VIEWS.map(view => <button key={view} type="button" className={BTN_QUIET}
          aria-pressed={map.mode === view} disabled={!canModify || map.mode === view}
          onClick={() => void switchGeneratedView(view)}>{view}</button>)}
      </div>}
      {generatorOpen && <div className="h-[70vh] min-h-[400px] overflow-auto rounded-panel border border-line p-3">
        <MapGeneratorPanel target={{ kind: 'existing', name: map.name }}
          initialSeed={map.seed} initialParams={map.params}
          onBusyChange={setGeneratorBusy} onUseAsBackground={generateBackground} />
      </div>}
      <div className={`h-[60vh] min-h-80 overflow-hidden rounded-panel border border-line ${generatorOpen ? 'hidden' : ''}`}>
        <MapCanvas map={map} viewport={viewport} points={shown} allLayersOff={shownLayers.length === 0}
          onMoveAnchor={(point, anchor) => setDraftAnchor({ key: mapKey(point.kind, point.id), anchor })}
          onCommitAnchor={(point, anchor) => updatePin(point.kind, point.id, anchor)}
          onRemoveAnchor={point => updatePin(point.kind, point.id, null)}
          onOpenAnchor={point => props.onNavigate(point.kind === 'worldEntry' ? 'world' : point.kind, point.id)}
          onEnableAllLayers={() => setShownLayers(DEFAULT_MAP_LAYERS.map(layer => layer.kind))}
          onPickBackground={() => { if (canModify) fileRef.current?.click() }}
          allowBackgroundEditing={canModify}
          readOnly={!edit || !canModify || generatorOpen}
          annotations={annotations} draft={edit && canModify ? draft : null}
          onDraftPoint={anchor => setDraft(current => current ? { ...current, points: [...current.points, anchor] } : null)}
          onCanvasContextMenu={(anchor, at) => { if (edit && canModify && draft === null) setCanvasMenu({ anchor, at, target: annotationAt(annotations, anchor) }) }}
          bleed />
      </div>
      {canvasMenu && edit && canModify && <MediaContextMenu at={canvasMenu.at}
        onClose={() => setCanvasMenu(null)} items={[
          ...(canvasMenu.target ? [
            { label: '颜色...', icon: <Palette size={13} strokeWidth={2} />,
              onSelect: () => { setPaintMenu({ target: canvasMenu.target!, at: canvasMenu.at }); setCanvasMenu(null) } },
            { label: '删除' + ANNOTATION_LABELS[canvasMenu.target.kind], danger: true,
              icon: <Trash2 size={13} strokeWidth={2} />,
              onSelect: () => { void persistAnnotations(annotations.filter(item => item.id !== canvasMenu.target!.id)); setCanvasMenu(null) } },
          ] : []),
          { label: '画国界', icon: <PenLine size={13} strokeWidth={2} />,
            onSelect: () => startDraft('border', canvasMenu.anchor) },
          { label: '画道路', icon: <Route size={13} strokeWidth={2} />,
            onSelect: () => startDraft('road', canvasMenu.anchor) },
        ]} />}
      {paintMenu && edit && canModify && <AnnotationColorMenu target={paintMenu.target} at={paintMenu.at}
        onClose={() => setPaintMenu(null)}
        onColor={color => { void changeAnnotation(paintMenu.target, { color }) }}
        onFill={fill => { void changeAnnotation(paintMenu.target, { fill }) }} />}
      <WorkspaceEntityHistory entityId={selected!.entityId} version={selected!.version} />
    </>}
    {!props.loading && maps.length === 0 && <p className="text-ui text-ink-muted">
      暂无地图。创建地图后上传底图，再放置国家、事件和词条锚点。
    </p>}
  </section>
}

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MapCanvas, type AnnotationDraft } from '@/features/map/components/MapCanvas'
import { useMapViewport } from '@/features/map/hooks/useMapViewport'
import { DEFAULT_MAP_LAYERS, MAP_LAYER_LABELS, type MapAnchor, type MapLayerKind } from '@/features/map/types'
import { minPoints, newAnnotationId, parseAnnotations, stringifyAnnotations } from '@/features/map/annotations'
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
  onNavigate: (kind: NavigationKind, id: number) => void
  canEdit: boolean
  disabled: boolean
  loading: boolean
  error?: string | null
}

function toMap(row: OriginalNoteSnapshot): MapEntity {
  const entity = row.entity
  return {
    id: entity.id, name: entity.title, image: entity.mapImage,
    width: entity.mapWidth, height: entity.mapHeight,
    seed: entity.mapSeed, params: entity.mapParams,
    mode: entity.mapMode, annotations: entity.mapAnnotations,
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
  const [edit, setEdit] = useState(false)
  const [shownLayers, setShownLayers] = useState<MapLayerKind[]>(DEFAULT_MAP_LAYERS.map(item => item.kind))
  const [draft, setDraft] = useState<AnnotationDraft | null>(null)
  const [draftAnchor, setDraftAnchor] = useState<{ key: string; anchor: MapAnchor } | null>(null)
  const [pick, setPick] = useState('')
  const [removeId, setRemoveId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [failedDraft, setFailedDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
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
    if (draft !== null) throw new Error('地图有尚未完成的标注，请先完成或取消')
    if (failedDraft !== null) throw new Error('地图上次保存失败，未保存的数据仍保留在页面中')
    return writing.current ?? undefined
  }), [draft, failedDraft])
  useWorkspaceDraftGuard(draft !== null || saving || failedDraft !== null, '地图')

  const upload = useWorkspaceImageUpload(props.workspaceId, canEdit && !disabled && !saving,
    setSaving, setError)

  async function execute(job: () => Promise<void>, unsaved?: unknown): Promise<void> {
    if (writing.current || disabled || !canEdit) return
    setError(null)
    setFailedDraft(null)
    setSaving(true)
    const task = job()
    writing.current = task
    try {
      await task
      setDraftAnchor(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存地图失败')
      setFailedDraft(JSON.stringify(unsaved ?? { map: activeName, draft }, null, 2))
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

  function finishAnnotation() {
    if (!draft || !map || draft.points.length < minPoints(draft.kind)) return
    const annotation = { id: newAnnotationId(), kind: draft.kind, points: draft.points }
    updateMap({ mapAnnotations: stringifyAnnotations([...annotations, annotation]) ?? null })
    setDraft(null)
  }

  function removeAnnotation() {
    if (!removeId) return
    updateMap({ mapAnnotations: stringifyAnnotations(annotations.filter(item => item.id !== removeId)) ?? null })
    setRemoveId('')
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
    const url = await upload(file, file.name)
    if (url) {
      updateMap({ mapImage: url, mapWidth: width, mapHeight: height })
    }
  }

  return <section className="flex min-w-0 flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
      <h2 className="mr-2 text-reading font-semibold">地图</h2>
      {maps.length > 0 && <select aria-label="选择地图" value={selected?.entity.id ?? ''}
        onChange={event => { setActiveId(Number(event.target.value)); setDraft(null); setDraftAnchor(null); setError(null) }}
        disabled={saving} className="rounded-control border border-line bg-paper px-2 py-1 text-ui">
        {maps.map(row => <option key={row.entity.id} value={row.entity.id}>{row.entity.title}</option>)}
      </select>}
      {canEdit && <><input aria-label="新地图名称" placeholder="新地图名称" value={name}
        onChange={event => setName(event.target.value)} disabled={disabled || saving}
        className="min-w-0 w-36 rounded-control border border-line bg-transparent px-2 py-1 text-ui" />
        <button className={BTN_QUIET} type="button" onClick={() => void createMap()}
          disabled={!name.trim() || disabled || saving}>新建地图</button></>}
      {map && canEdit && <button type="button" className={BTN_QUIET}
        disabled={disabled || saving} onClick={() => { setEdit(value => !value); setDraft(null) }}>
        {edit ? '完成编辑' : '编辑地图'}
      </button>}
    </div>
    {props.loading && <p className="text-ui text-ink-muted">正在读取地图…</p>}
    {props.error && <p role="alert" className="text-ui text-error">{props.error}</p>}
    {error && <div role="alert" className="text-ui text-error">{error}
      {failedDraft && <details><summary>复制未保存数据</summary><textarea readOnly className="w-full" value={failedDraft}/></details>}
    </div>}
    {map && <>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
        aria-label="上传地图底图" disabled={!canModify}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void setBackground(file) }} />
      {edit && canEdit && <div className="flex flex-wrap items-center gap-2 text-ui">
        <button type="button" className={BTN_QUIET} onClick={() => fileRef.current?.click()}
          disabled={!canModify}>上传底图</button>
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
          onClick={() => setDraft({ kind: 'border', points: [] })}>绘制国界</button>
        <button type="button" className={BTN_QUIET} disabled={!canModify || draft !== null}
          onClick={() => setDraft({ kind: 'road', points: [] })}>绘制道路</button>
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
          disabled={saving || draft.points.length < minPoints(draft.kind)} onClick={finishAnnotation}>完成标注</button>
        <button type="button" className={BTN_QUIET} onClick={() => setDraft(null)}>取消绘制</button>
      </div>}
      <div className="h-[60vh] min-h-80 overflow-hidden rounded-panel border border-line">
        <MapCanvas map={map} viewport={viewport} points={shown} allLayersOff={shownLayers.length === 0}
          onMoveAnchor={(point, anchor) => setDraftAnchor({ key: mapKey(point.kind, point.id), anchor })}
          onCommitAnchor={(point, anchor) => updatePin(point.kind, point.id, anchor)}
          onRemoveAnchor={point => updatePin(point.kind, point.id, null)}
          onOpenAnchor={point => props.onNavigate(point.kind === 'worldEntry' ? 'world' : point.kind, point.id)}
          onEnableAllLayers={() => setShownLayers(DEFAULT_MAP_LAYERS.map(layer => layer.kind))}
          onPickBackground={() => { if (canModify) fileRef.current?.click() }}
          readOnly={!edit || !canModify}
          annotations={annotations} draft={edit && canModify ? draft : null}
          onDraftPoint={anchor => setDraft(current => current ? { ...current, points: [...current.points, anchor] } : null)}
          bleed />
      </div>
      <WorkspaceEntityHistory entityId={selected!.entityId} version={selected!.version} />
    </>}
    {!props.loading && maps.length === 0 && <p className="text-ui text-ink-muted">
      暂无地图。创建地图后上传底图，再放置国家、事件和词条锚点。
    </p>}
  </section>
}

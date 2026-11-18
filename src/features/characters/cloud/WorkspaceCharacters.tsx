'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Providers } from '@/app/providers'
import { SaveStatusProvider, useSaveStatus } from '@/components/layout/SaveStatusContext'
import { Toaster } from '@/components/shared/toaster'
import { GalleryBlock, SummaryBlock } from '@/components/shared/template-blocks'
import { CharacterInfoSection } from '@/features/characters/components/CharacterInfoSection'
import { characterFormBaseline, useCharacterForm } from '@/features/characters/hooks/useCharacterForm'
import { buildDefaultCharacter } from '@/features/characters/services'
import type { CharacterFormData } from '@/features/characters/types'
import { newCharacterData, newCountryData } from '@/lib/entity-defaults'
import { BUILTIN_FIELDS } from '@/lib/fields'
import { flushPendingSaves } from '@/lib/pending-saves'
import { BTN_PRIMARY, BTN_QUIET, TITLE_INPUT } from '@/lib/ui-tokens'
import { OriginalCharactersCloudAdapter, type OriginalCharacterSnapshot, type OriginalCharacterPatch } from '@/lib/cloud/adapters/original-characters'
import type { WorkspaceRole } from '@/lib/cloud/permissions'
import type { Character, Country } from '@/types'
import type { Editor } from '@tiptap/core'
import { EditorCore } from '@/components/editor/EditorCore'
import { ActiveEditorProvider } from '@/lib/editor-context'
import { legacyBodySections } from '@/lib/body-content'
import { hasNewBodyImages } from '@/lib/cloud/character-media'
import { ProfileBannerEditor } from '@/components/shared/ProfileBannerEditor'
import { RelationsSection } from '@/components/shared/relations/RelationsSection'

import { OriginalCountriesCloudAdapter, type OriginalCountrySnapshot } from '@/lib/cloud/adapters/original-countries'
import { OriginalCountryEditor } from '@/features/countries/cloud/OriginalCountryEditor'
import { buildDefaultCountry } from '@/features/countries/services'
import { WorkspaceEntityHistory } from '@/components/cloud/WorkspaceEntityHistory'
import { insertWorkspaceBodyImage, useWorkspaceDraftGuard, useWorkspaceImageUpload } from '@/components/cloud/workspace-editor-guards'

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

export function WorkspaceCharacters({ workspaceId, role }: { workspaceId: string; role: WorkspaceRole }) {
  return <Providers><ActiveEditorProvider><SaveStatusProvider>
    <CharacterWorkspace key={workspaceId} workspaceId={workspaceId} role={role} />
    <Toaster />
  </SaveStatusProvider></ActiveEditorProvider></Providers>
}

function CharacterWorkspace({ workspaceId, role }: { workspaceId: string; role: WorkspaceRole }) {
  const adapter = useMemo(() => new OriginalCharactersCloudAdapter(workspaceId), [workspaceId])
  const countriesAdapter = useMemo(() => new OriginalCountriesCloudAdapter(workspaceId), [workspaceId])
  const [rows, setRows] = useState<OriginalCharacterSnapshot[]>([])
  const [countryRows, setCountryRows] = useState<OriginalCountrySnapshot[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = rows.find(row => row.entityId === selectedId)
  const selectedCountry = countryRows.find(row => row.entityId === selectedId)
  const characters = useMemo(() => rows.map(row => row.character), [rows])
  const countries = useMemo(() => countryRows.map(row => row.entity), [countryRows])
  const [loading, setLoading] = useState(true)
  const [countriesLoading, setCountriesLoading] = useState(true)
  const [countriesError, setCountriesError] = useState<string | null>(null)
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

  useEffect(() => {
    let current = true
    void countriesAdapter.list().then(result => {
      if (current) setCountryRows(result)
    }).catch(cause => {
      if (current) setCountriesError(cause instanceof Error ? cause.message : '国家加载失败')
    }).finally(() => {
      if (current) setCountriesLoading(false)
    })
    return () => { current = false }
  }, [countriesAdapter])

  const select = useCallback(async (nextId: string) => {
    if (busy || nextId === selectedId) return
    setBusy(true)
    setError(null)
    try {
      // 原版保存流水线会追上保存期间继续输入的内容；失败时保留当前编辑器。
      await flushPendingSaves()
      setSelectedId(nextId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '当前草稿保存失败')
    } finally { setBusy(false) }
  }, [busy, selectedId])

  async function create() {
    if (busy || !canEdit) return
    setBusy(true)
    setError(null)
    try {
      await flushPendingSaves()
      const next = await adapter.create(buildDefaultCharacter(newCharacterData()))
      setRows(current => [...current, next])
      setSelectedId(next.entityId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '角色创建失败')
    } finally { setBusy(false) }
  }

  async function createCountry() {
    if (busy || !canEdit) return
    setBusy(true)
    setError(null)
    try {
      await flushPendingSaves()
      const next = await countriesAdapter.create(buildDefaultCountry(newCountryData()))
      setCountryRows(current => [...current, next])
      setSelectedId(next.entityId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '国家创建失败')
    } finally { setBusy(false) }
  }

  const savedCountry = useCallback((next: OriginalCountrySnapshot) => {
    setCountryRows(current => current.map(row => row.entityId === next.entityId ? next : row))
  }, [])

  const saved = useCallback((next: OriginalCharacterSnapshot) => {
    setRows(current => current.map(row => row.entityId === next.entityId ? next : row))
  }, [])

  return <div className="flex flex-col gap-4">
    <section className="flex flex-col gap-4 border-t border-line pt-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-reading font-semibold">角色</h2>
        {canEdit && <button type="button" className={BTN_QUIET} disabled={busy || loading} onClick={() => void create()}>新建角色</button>}
      </div>
      {loading ? <p className="text-ui text-ink-muted">正在读取角色…</p> : <div className="flex flex-wrap gap-2">
        {rows.map(row => <button type="button" key={row.entityId} className={BTN_QUIET}
          aria-pressed={selected?.entityId === row.entityId} disabled={busy}
          onClick={() => void select(row.entityId)}>{row.character.name}</button>)}
        {rows.length === 0 && <p className="text-ui text-ink-muted">暂无角色</p>}
      </div>}
    </section>
    <section className="flex flex-col gap-4 border-t border-line pt-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-reading font-semibold">国家</h2>
        {canEdit && <button type="button" className={BTN_QUIET}
          disabled={busy || countriesLoading || countriesError !== null} onClick={() => void createCountry()}>新建国家</button>}
      </div>
      {countriesError && <p role="alert" className="text-ui text-error">{countriesError}</p>}
      {countriesLoading ? <p className="text-ui text-ink-muted">正在读取国家…</p> : <div className="flex flex-wrap gap-2">
        {countryRows.map(row => <button type="button" key={row.entityId} className={BTN_QUIET}
          aria-pressed={selectedId === row.entityId} disabled={busy}
          onClick={() => void select(row.entityId)}>{row.entity.name}</button>)}
        {countryRows.length === 0 && !countriesError && <p className="text-ui text-ink-muted">暂无国家</p>}
      </div>}
    </section>
    {error && <p role="alert" className="text-ui text-error">{error}</p>}
    {selected && <OriginalCharacterEditor key={selected.entityId} snapshot={selected} adapter={adapter}
      characters={characters} countries={countries} countriesReady={!countriesLoading && !countriesError}
      onNavigateCharacter={id => {
        const target = rows.find(row => row.character.id === id)
        if (target) void select(target.entityId)
      }}
      onNavigateCountry={id => {
        const target = countryRows.find(row => row.entity.id === id)
        if (target) void select(target.entityId)
      }}
      canEdit={canEdit} disabled={busy} onUploadBusy={setBusy} onSaved={saved} />}
    {selectedCountry && <OriginalCountryEditor key={selectedCountry.entityId} snapshot={selectedCountry}
      adapter={countriesAdapter} characters={characters} canEdit={canEdit} disabled={busy}
      onSaved={savedCountry} onUploadBusy={setBusy}
      onNavigateCharacter={id => {
        const target = rows.find(row => row.character.id === id)
        if (target) void select(target.entityId)
      }} />}
  </div>
}

function OriginalCharacterEditor({ snapshot, adapter, characters, countries, countriesReady, onNavigateCharacter, onNavigateCountry, canEdit, disabled, onUploadBusy, onSaved }: {
  snapshot: OriginalCharacterSnapshot
  adapter: OriginalCharactersCloudAdapter
  characters: Character[]
  countries: Country[]
  countriesReady: boolean
  onNavigateCountry: (id: number) => void
  onNavigateCharacter: (id: number) => void
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
  const form = useCharacterForm(snapshot.character, save, { localLookups: false, characters, countries })
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
            relatedCharacters: form.relatedCharacters,
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
        rows={form.relationRows.filter(row => row.kind === 'character')}
        inbound={form.inboundRelationRows}
        candidates={form.relationCandidates.filter(candidate => candidate.kind === 'character')}
        onAdd={canEdit && !disabled ? form.addRelation : undefined}
        onRemove={canEdit && !disabled ? form.removeRelation : undefined}
        onRename={canEdit && !disabled ? form.renameRelation : undefined}
        onArrowChange={canEdit && !disabled ? form.setRelationArrow : undefined}
        onNavigate={(_kind, id) => onNavigateCharacter(id)} />
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

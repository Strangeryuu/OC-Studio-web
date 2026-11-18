'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { WorkspaceEntityHistory } from '@/components/cloud/WorkspaceEntityHistory'
import { insertWorkspaceBodyImage, useWorkspaceDraftGuard, useWorkspaceImageUpload } from '@/components/cloud/workspace-editor-guards'
import { EditorCore } from '@/components/editor/EditorCore'
import { useSaveStatus } from '@/components/layout/SaveStatusContext'
import { ProfileBannerEditor } from '@/components/shared/ProfileBannerEditor'
import { RelationsSection } from '@/components/shared/relations/RelationsSection'
import { GalleryBlock, SummaryBlock } from '@/components/shared/template-blocks'
import { CountryInfoSection } from '@/features/countries/components/CountryInfoSection'
import { mergeCountrySections, useCountryForm } from '@/features/countries/hooks/useCountryForm'
import type { CountryFormData } from '@/features/countries/types'
import type { OriginalCountriesCloudAdapter, OriginalCountryPatch, OriginalCountrySnapshot } from '@/lib/cloud/adapters/original-countries'
import { hasNewBodyImages } from '@/lib/cloud/character-media'
import { snapshotKey } from '@/lib/dirty'
import { docRevisionChanged } from '@/lib/save-revision'
import { DEFAULT_CUSTOM_FIELDS } from '@/lib/fields'
import { BTN_PRIMARY, BTN_QUIET, TITLE_INPUT } from '@/lib/ui-tokens'
import type { Character } from '@/types'

const COUNTRY_FIELDS = DEFAULT_CUSTOM_FIELDS.country ?? []

export function OriginalCountryEditor({ snapshot, adapter, characters, canEdit, disabled, onSaved, onNavigateCharacter, onUploadBusy }: {
  snapshot: OriginalCountrySnapshot
  adapter: OriginalCountriesCloudAdapter
  characters: Character[]
  canEdit: boolean
  disabled: boolean
  onUploadBusy: (busy: boolean) => void
  onSaved: (next: OriginalCountrySnapshot) => void
  onNavigateCharacter: (id: number) => void
}) {
  const baseline = useRef(snapshot)
  const bodyEditor = useRef<Editor | null>(null)
  const bodyBaseline = useRef<Editor['state']['doc'] | null>(null)
  const [bodyDraft, setBodyDraft] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const { status, setActiveEntity } = useSaveStatus()
  const save = useCallback(async (_id: number, values: Partial<CountryFormData>) => {
    const current = baseline.current.entity
    const patch: OriginalCountryPatch = {}
    if (values.name !== undefined && values.name !== current.name) patch.name = values.name
    if (values.description !== undefined && values.description !== current.description) patch.description = values.description
    if (values.flagUrl !== undefined && values.flagUrl !== (current.flagUrl ?? '')) patch.flagUrl = values.flagUrl
    if (values.headerUrl !== undefined && values.headerUrl !== (current.headerUrl ?? '')) patch.headerUrl = values.headerUrl
    if (values.gallery !== undefined && JSON.stringify(values.gallery) !== JSON.stringify(current.gallery ?? [])) patch.gallery = values.gallery
    if (values.custom !== undefined && snapshotKey(values.custom) !== snapshotKey(current.custom ?? {})) patch.custom = values.custom
    const doc = bodyEditor.current?.state.doc
    try {
      if (values.document !== undefined && doc && bodyBaseline.current &&
          docRevisionChanged(doc, bodyBaseline.current)) {
        if (hasNewBodyImages(current.document, values.document)) throw new Error('请使用正文的上传按钮添加图片')
        patch.document = values.document
      }
      if (Object.keys(patch).length > 0) {
        const next = await adapter.save(baseline.current, patch)
        baseline.current = next
        onSaved(next)
      }
      if (doc) bodyBaseline.current = doc
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '国家保存失败')
      throw cause
    }
  }, [adapter, onSaved])
  const form = useCountryForm(snapshot.entity, save, { localLookups: false, characters })
  const { handleDocReady, handleDocChange } = form
  const onEditorReady = useCallback((editor: Editor) => {
    bodyEditor.current = editor
    bodyBaseline.current = editor.state.doc
    editor.setEditable(canEdit && !disabled)
    handleDocReady(editor)
    setBodyDraft(editor.getJSON())
  }, [canEdit, disabled, handleDocReady])
  const onBodyChange = useCallback(() => {
    handleDocChange()
    if (bodyEditor.current) setBodyDraft(bodyEditor.current.getJSON())
  }, [handleDocChange])
  useEffect(() => { bodyEditor.current?.setEditable(canEdit && !disabled) }, [canEdit, disabled])
  useEffect(() => {
    setActiveEntity('country')
    return () => setActiveEntity(null)
  }, [setActiveEntity])
  useWorkspaceDraftGuard(form.dirty || form.saving || disabled, '国家')
  const upload = useWorkspaceImageUpload(snapshot.workspaceId, canEdit && !disabled, onUploadBusy, setError)
  const canModify = canEdit && !disabled

  function uploadImage(blob: Blob, type: 'header' | 'avatar' | 'gallery' | 'portrait') {
    return upload(blob, `${type === 'avatar' ? 'flag' : type}.png`)
  }

  const country = snapshot.entity
  return <div className="flex flex-col gap-5 rounded-panel border border-line p-5">
    <div className="flex items-center justify-between gap-3">
      <span className="text-caption text-ink-muted">{form.saving ? '保存中…' : form.dirty ? '未保存' : status === 'saved' ? '已保存' : '已同步'}</span>
      {canEdit && <button type="button" className={BTN_PRIMARY} disabled={disabled || form.saving || !form.name.trim()}
        onClick={() => void form.handleSave()}>保存</button>}
    </div>
    {error && <div role="alert" className="text-ui text-error">
      <p>{error}</p>
      <details>
        <summary>复制未保存的国家草稿</summary>
        <textarea readOnly aria-label="未保存的国家草稿" className="w-full" value={JSON.stringify({
          name: form.name, description: form.description, custom: form.custom,
          headerUrl: form.headerUrl, flagUrl: form.flagUrl, gallery: form.gallery,
          document: bodyDraft,
        }, null, 2)} />
      </details>
    </div>}
    <ProfileBannerEditor headerUrl={form.headerUrl} avatarUrl={form.flagUrl} avatarType="flag"
      onHeaderChange={canModify ? form.setHeaderUrl : undefined}
      onAvatarChange={canModify ? form.setFlagUrl : undefined}
      onHeaderRemove={canModify ? () => form.setHeaderUrl('') : undefined}
      onAvatarRemove={canModify ? () => form.setFlagUrl('') : undefined}
      saveImage={uploadImage} />
    <fieldset disabled={!canEdit || disabled} className="flex flex-col gap-5">
      <input type="text" aria-label="国家名称" value={form.name}
        onChange={event => form.setName(event.target.value)} className={TITLE_INPUT} />
      <CountryInfoSection values={form.custom} onChange={form.setCustomValue} fieldsOverride={COUNTRY_FIELDS} />
      <SummaryBlock value={form.description} onChange={form.setDescription} />
    </fieldset>
    <RelationsSection title="相关角色" selfName={form.name} rows={form.relationRows}
      onNavigate={(_kind, id) => { if (!disabled) onNavigateCharacter(id) }} />
    <GalleryBlock title="相册" images={form.gallery.map(image => image.url)}
      onAdd={canModify ? url => form.setGallery(current => [...current, { url, caption: '' }]) : undefined}
      onReplace={canModify ? (index, url) => form.setGallery(current =>
        current.map((image, i) => i === index ? { ...image, url } : image)) : undefined}
      onRemove={canModify ? index => form.setGallery(current => current.filter((_, i) => i !== index)) : undefined}
      saveImage={uploadImage} />
    <section className="border-t border-line pt-4">
      <h3 className="text-ui font-semibold">正文</h3>
      {canEdit && <label className={`${BTN_QUIET} cursor-pointer`}>
        上传正文图片
        <input type="file" aria-label="上传正文图片" accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only" disabled={disabled} onChange={event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            const editor = bodyEditor.current
            if (file && editor) void upload(file, undefined, url => insertWorkspaceBodyImage(editor, url))
          }} />
      </label>}
      <EditorCore plain imageUploads={false} localReferences={false}
        content={country.document ?? mergeCountrySections(country.system, country.geography, country.culture) ?? ''}
        onReady={onEditorReady} onContentChange={onBodyChange} />
    </section>
    <WorkspaceEntityHistory entityId={snapshot.entityId} version={snapshot.version} />
  </div>
}

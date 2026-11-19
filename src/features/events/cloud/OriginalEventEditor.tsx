'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { WorkspaceEntityHistory } from '@/components/cloud/WorkspaceEntityHistory'
import { insertWorkspaceBodyImage, useWorkspaceDraftGuard, useWorkspaceImageUpload } from '@/components/cloud/workspace-editor-guards'
import { WorkspaceBodyImageControls } from '@/components/cloud/WorkspaceBodyImageControls'
import { EditorCore } from '@/components/editor/EditorCore'
import { useSaveStatus } from '@/components/layout/SaveStatusContext'
import { ProfileBannerEditor } from '@/components/shared/ProfileBannerEditor'
import { RelationsSection } from '@/components/shared/relations/RelationsSection'
import type { RelationTargetKind } from '@/components/shared/relations/types'
import { GalleryBlock, SummaryBlock } from '@/components/shared/template-blocks'
import { EventInfoSection } from '@/features/events/components/EventInfoSection'
import { eventFormBaseline, useEventForm } from '@/features/events/hooks/useEventForm'
import type { EventFormData } from '@/features/events/types'
import type { OriginalEventsCloudAdapter, OriginalEventPatch, OriginalEventSnapshot } from '@/lib/cloud/adapters/original-events'
import { hasNewBodyImages } from '@/lib/cloud/character-media'
import { snapshotKey } from '@/lib/dirty'
import { BUILTIN_FIELDS } from '@/lib/fields'
import { docRevisionChanged } from '@/lib/save-revision'
import type { ReferableEntity } from '@/lib/reference-registry'
import { BTN_PRIMARY, BTN_QUIET, TITLE_INPUT } from '@/lib/ui-tokens'
import type { Character, Country, Event } from '@/types'

const EDITABLE_KEYS = [
  'title', 'time', 'endTime', 'location', 'summary', 'isMajor', 'headerUrl',
  'images', 'characters', 'countries', 'relations',
] as const satisfies readonly (keyof OriginalEventPatch)[]

export function OriginalEventEditor({ snapshot, adapter, lookups, referenceItems, canEdit, disabled, onSaved, onNavigate, onUploadBusy }: {
  snapshot: OriginalEventSnapshot
  adapter: OriginalEventsCloudAdapter
  lookups: { characters: Character[]; countries: Country[]; events: Event[] }
  referenceItems: ReferableEntity[]
  canEdit: boolean
  disabled: boolean
  onSaved: (next: OriginalEventSnapshot) => void
  onNavigate: (kind: RelationTargetKind, id: number) => void
  onUploadBusy: (busy: boolean) => void
}) {
  const baseline = useRef(snapshot)
  const bodyEditor = useRef<Editor | null>(null)
  const bodyBaseline = useRef<Editor['state']['doc'] | null>(null)
  const [bodyDraft, setBodyDraft] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const { status, setActiveEntity } = useSaveStatus()

  const save = useCallback(async (_id: number, values: Partial<EventFormData>) => {
    const original = baseline.current.entity
    const fields = eventFormBaseline(original)
    const patch: OriginalEventPatch = {}
    for (const key of EDITABLE_KEYS) {
      if (values[key] !== undefined && snapshotKey(values[key]) !== snapshotKey(fields[key])) {
        Object.assign(patch, { [key]: values[key] })
      }
    }

    const doc = bodyEditor.current?.state.doc
    try {
      if (values.document !== undefined && doc && bodyBaseline.current && docRevisionChanged(doc, bodyBaseline.current)) {
        if (hasNewBodyImages(original.document, values.document)) throw new Error('请使用正文的上传按钮添加图片')
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
      setError(cause instanceof Error ? cause.message : '事件保存失败')
      throw cause
    }
  }, [adapter, onSaved])

  const form = useEventForm(snapshot.entity, save, lookups)
  const { handleEditorReady, handleDocChange } = form
  const canModify = canEdit && !disabled
  const onEditorReady = useCallback((editor: Editor) => {
    bodyEditor.current = editor
    bodyBaseline.current = editor.state.doc
    editor.setEditable(canModify)
    handleEditorReady(editor)
    setBodyDraft(editor.getJSON())
  }, [canModify, handleEditorReady])
  const onBodyChange = useCallback(() => {
    handleDocChange()
    if (bodyEditor.current) setBodyDraft(bodyEditor.current.getJSON())
  }, [handleDocChange])
  useEffect(() => { bodyEditor.current?.setEditable(canModify) }, [canModify])
  useEffect(() => {
    setActiveEntity('event')
    return () => setActiveEntity(null)
  }, [setActiveEntity])
  useWorkspaceDraftGuard(form.dirty || form.saving || disabled, '事件')
  const upload = useWorkspaceImageUpload(snapshot.workspaceId, canModify, onUploadBusy, setError)
  const uploadImage = (blob: Blob, type: 'header' | 'avatar' | 'gallery' | 'portrait') => upload(blob, `${type}.png`)

  const event = snapshot.entity
  return <div className="flex flex-col gap-5 rounded-panel border border-line p-5">
    <div className="flex items-center justify-between gap-3">
      <span className="text-caption text-ink-muted">{form.saving ? '保存中…' : form.dirty ? '未保存' : status === 'saved' ? '已保存' : '已同步'}</span>
      {canEdit && <button type="button" className={BTN_PRIMARY} disabled={disabled || form.saving || !form.title.trim()}
        onClick={() => void form.handleSave()}>保存</button>}
    </div>
    {error && <div>
      <p role="alert" className="text-ui text-error">{error}</p>
      <details className="mt-2 text-ui text-ink-muted">
        <summary>查看并复制当前草稿</summary>
        <textarea readOnly aria-label="当前事件草稿" className="mt-2 h-48 w-full rounded-control border border-line bg-transparent p-2"
          value={JSON.stringify({
            title: form.title, summary: form.summary, location: form.location, isMajor: form.isMajor,
            time: [form.year, form.month, form.day].join('-'),
            endTime: [form.endYear, form.endMonth, form.endDay].join('-'),
            characters: form.selectedCharacterIds, countries: form.selectedCountryIds, relations: form.relations,
            headerUrl: form.headerUrl, images: form.images, document: bodyDraft,
          }, null, 2)} />
      </details>
    </div>}
    <ProfileBannerEditor headerUrl={form.headerUrl} onHeaderChange={canModify ? form.setHeaderUrl : undefined}
      onHeaderRemove={canModify ? () => form.setHeaderUrl('') : undefined} saveImage={uploadImage} />
    <fieldset disabled={!canModify} className="flex flex-col gap-5">
      <input type="text" aria-label="事件名称" value={form.title}
        onChange={change => form.setTitle(change.target.value)} className={TITLE_INPUT} />
      <EventInfoSection form={form} fieldsOverride={BUILTIN_FIELDS.event} />
      <SummaryBlock value={form.summary} onChange={form.setSummary} />
    </fieldset>
    <RelationsSection title="事件关系" selfName={form.title}
      rows={form.relationRows} candidates={form.relationCandidates}
      onAdd={canModify ? form.addRelation : undefined}
      onRemove={canModify ? form.removeRelation : undefined}
      onRename={canModify ? form.renameRelation : undefined}
      onArrowChange={canModify ? form.setRelationArrow : undefined}
      onNavigate={disabled ? undefined : onNavigate} />
    <GalleryBlock title="相册" images={form.images.map(image => image.url)}
      onAdd={canModify ? url => form.setImages(current => [...current, { url, caption: '' }]) : undefined}
      onReplace={canModify ? (index, url) => form.setImages(current =>
        current.map((image, i) => i === index ? { ...image, url } : image)) : undefined}
      onRemove={canModify ? index => form.setImages(current => current.filter((_, i) => i !== index)) : undefined}
      saveImage={uploadImage} />
    <section className="border-t border-line pt-4">
      <h3 className="text-ui font-semibold">正文</h3>
      {canEdit && <label className={`${BTN_QUIET} cursor-pointer`}>
        上传正文图片
        <input type="file" aria-label="上传正文图片" accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only" disabled={disabled} onChange={change => {
            const file = change.target.files?.[0]
            change.target.value = ''
            const editor = bodyEditor.current
            if (file && editor) void upload(file, undefined, url => insertWorkspaceBodyImage(editor, url))
          }} />
      </label>}
      <WorkspaceBodyImageControls editor={bodyEditor.current} document={bodyDraft}
        editable={canModify} upload={file => upload(file, file.name)} />
      <EditorCore plain imageUploads={false} localReferences={false} referenceItems={referenceItems}
        content={event.document ?? event.content}
        onReady={onEditorReady} onContentChange={onBodyChange} />
    </section>
    <WorkspaceEntityHistory entityId={snapshot.entityId} version={snapshot.version} />
  </div>
}

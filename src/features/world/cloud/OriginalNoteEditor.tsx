'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { WorkspaceEntityHistory } from '@/components/cloud/WorkspaceEntityHistory'
import { insertWorkspaceBodyImage, useWorkspaceDraftGuard, useWorkspaceImageUpload } from '@/components/cloud/workspace-editor-guards'
import { EditorCore } from '@/components/editor/EditorCore'
import { useSaveStatus } from '@/components/layout/SaveStatusContext'
import { useEditorDirty } from '@/components/layout/useEditorDirty'
import { useAutoSave } from '@/components/layout/use-auto-save'
import { RelatedItemsSelector } from '@/components/shared/RelatedItemsSelector'
import { ProfileBannerEditor } from '@/components/shared/ProfileBannerEditor'
import type { RelationTargetKind } from '@/components/shared/relations/types'
import { GalleryBlock, SummaryBlock } from '@/components/shared/template-blocks'
import type { OriginalNotesCloudAdapter, OriginalNotePatch, OriginalNoteSnapshot } from '@/lib/cloud/adapters/original-notes'
import { hasNewBodyImages } from '@/lib/cloud/character-media'
import { parseOriginalId } from '@/lib/cloud/original-ids'
import { snapshotKey } from '@/lib/dirty'
import type { ReferableEntity } from '@/lib/reference-registry'
import { docRevisionChanged } from '@/lib/save-revision'
import { BTN_PRIMARY, BTN_QUIET, FIELD_LABEL, FIELD_ROW, TITLE_INPUT } from '@/lib/ui-tokens'
import { useSavePipeline } from '@/lib/use-save-pipeline'
import { worldBodyOf, worldBodyPatch } from '@/lib/world-body'
import type { Character, WorldEntry } from '@/types'
import { NoteRelationFields } from '../components/note/NoteBlocks'
import { buildNoteLinks } from '../hooks/useNoteLinks'

function fieldsOf(note: WorldEntry) {
  return {
    title: note.title,
    summary: note.summary ?? '',
    cover: note.cover ?? '',
    gallery: note.gallery ?? [],
    relations: note.relations ?? [],
    parentId: note.parentId,
  }
}

const FIELD_KEYS = ['title', 'summary', 'cover', 'gallery', 'relations', 'parentId'] as const

export function OriginalNoteEditor({ snapshot, adapter, notes, characters, references, canEdit, disabled,
  onSaved, onNavigate, onUploadBusy, onCreateChild }: {
  snapshot: OriginalNoteSnapshot
  adapter: OriginalNotesCloudAdapter
  notes: WorldEntry[]
  characters: Character[]
  references: ReferableEntity[]
  canEdit: boolean
  disabled: boolean
  onSaved: (next: OriginalNoteSnapshot) => void
  onNavigate: (kind: RelationTargetKind, id: number) => void
  onUploadBusy: (busy: boolean) => void
  onCreateChild: () => void
}) {
  const [fields, setFields] = useState(() => fieldsOf(snapshot.entity))
  const [error, setError] = useState<string | null>(null)
  const [bodyDraft, setBodyDraft] = useState<unknown>(null)
  const [docDirty, setDocDirty] = useState(false)
  const baseline = useRef(snapshot)
  const bodyEditor = useRef<Editor | null>(null)
  const bodyBaseline = useRef<Editor['state']['doc'] | null>(null)
  const { status, markSaving, reportDirty, setActiveEntity, registerSaveHandler } = useSaveStatus()
  const canModify = canEdit && !disabled
  const fieldsDirty = snapshotKey(fields) !== snapshotKey(fieldsOf(snapshot.entity))
  const dirty = fieldsDirty || docDirty

  function setField<K extends typeof FIELD_KEYS[number]>(key: K, value: typeof fields[K]) {
    setFields(previous => ({ ...previous, [key]: value }))
  }

  const readChangedBody = () => {
    const doc = bodyEditor.current?.state.doc
    return doc && bodyBaseline.current && docRevisionChanged(doc, bodyBaseline.current) ? doc : null
  }

  const { save, saving } = useSavePipeline({
    isDirty: () => canEdit && (snapshotKey(fields) !== snapshotKey(fieldsOf(baseline.current.entity)) || readChangedBody() !== null),
    commit: async () => {
      const original = baseline.current.entity
      const previous = fieldsOf(original)
      const patch: OriginalNotePatch = {}
      for (const key of FIELD_KEYS) {
        if (snapshotKey(fields[key]) !== snapshotKey(previous[key])) Object.assign(patch, { [key]: fields[key] })
      }
      const doc = readChangedBody()
      try {
        if (doc) {
          const nextBody = doc.toJSON()
          if (hasNewBodyImages(worldBodyOf(original), nextBody)) throw new Error('请使用正文的上传按钮添加图片')
          Object.assign(patch, worldBodyPatch(nextBody))
        }
        markSaving()
        const saved = await adapter.save(baseline.current, patch)
        baseline.current = saved
        if (doc) bodyBaseline.current = doc
        setDocDirty(readChangedBody() !== null)
        setError(null)
        onSaved(saved)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '笔记保存失败')
        reportDirty(true)
        throw cause
      }
    },
  })
  useAutoSave({ dirty: canEdit && dirty, saving, save })
  useEditorDirty('world', snapshot.entity.id, dirty, saving, '')
  useWorkspaceDraftGuard(dirty || saving || disabled, '笔记')
  useEffect(() => {
    setActiveEntity('world')
    registerSaveHandler('world', save)
    return () => { registerSaveHandler('world', null); setActiveEntity(null) }
  }, [registerSaveHandler, save, setActiveEntity])

  const onEditorReady = useCallback((editor: Editor) => {
    bodyEditor.current = editor
    bodyBaseline.current = editor.state.doc
    editor.setEditable(canModify)
    setBodyDraft(editor.getJSON())
  }, [canModify])
  const onBodyChange = useCallback(() => {
    const doc = bodyEditor.current?.state.doc
    if (doc && bodyBaseline.current) {
      setBodyDraft(doc.toJSON())
      setDocDirty(docRevisionChanged(doc, bodyBaseline.current))
    }
  }, [])
  useEffect(() => { bodyEditor.current?.setEditable(canModify) }, [canModify])

  const upload = useWorkspaceImageUpload(snapshot.workspaceId, canModify, onUploadBusy, setError)
  const uploadImage = (blob: Blob, kind: 'header' | 'avatar' | 'gallery' | 'portrait') => upload(blob, `${kind}.png`)
  const parentItems = useMemo(() => {
    const children = new Map<number, number[]>()
    for (const note of notes) {
      if (note.parentId === null) continue
      const siblings = children.get(note.parentId) ?? []
      siblings.push(note.id)
      children.set(note.parentId, siblings)
    }
    const excluded = new Set([snapshot.entity.id])
    const pending = [snapshot.entity.id]
    for (const id of pending) {
      for (const child of children.get(id) ?? []) {
        if (!excluded.has(child)) {
          excluded.add(child)
          pending.push(child)
        }
      }
    }
    return notes.filter(note => !excluded.has(note.id)).map(note => ({ id: note.id, name: note.title }))
  }, [notes, snapshot.entity.id])
  // Stale parents absent from the directory must not prevent selecting a new one.
  const selectedParentIds = fields.parentId !== null && parentItems.some(item => item.id === fields.parentId)
    ? [fields.parentId] : []
  const links = useMemo(
    () => buildNoteLinks(notes.map(note => note.id === snapshot.entity.id ? { ...note, relations: fields.relations, parentId: fields.parentId } : note),
      snapshot.entity.id, characters),
    [notes, snapshot.entity.id, characters, fields.relations, fields.parentId],
  )
  function openReference(raw: string, kind?: string) {
    const id = parseOriginalId(raw)
    if (id !== null && !disabled && (kind === 'world' || kind === 'character' || kind === 'country' || kind === 'event')) {
      onNavigate(kind, id)
    }
  }

  return <div className="flex flex-col gap-5 rounded-panel border border-line p-5">
    <div className="flex items-center justify-between gap-3">
      <span className="text-caption text-ink-muted">{saving ? '保存中…' : dirty ? '未保存' : status === 'saved' ? '已保存' : '已同步'}</span>
      {canEdit && <div className="flex items-center gap-2">
        <button type="button" className={BTN_QUIET} disabled={disabled || !fields.title.trim()}
          onClick={onCreateChild}>新建子笔记</button>
        <button type="button" className={BTN_PRIMARY} disabled={disabled || saving || !fields.title.trim()}
          onClick={() => void save()}>保存</button>
      </div>}
    </div>
    {error && <div>
      <p role="alert" className="text-ui text-error">{error}</p>
      <details>
        <summary>查看并复制当前草稿</summary>
        <textarea readOnly aria-label="当前笔记草稿" className="w-full"
          value={JSON.stringify({ ...fields, document: bodyDraft }, null, 2)} />
      </details>
    </div>}
    <ProfileBannerEditor headerUrl={fields.cover} onHeaderChange={canModify ? url => setField('cover', url) : undefined}
      onHeaderRemove={canModify ? () => setField('cover', '') : undefined} saveImage={uploadImage} />
    <fieldset disabled={!canModify} className="flex flex-col gap-5">
      <input type="text" aria-label="笔记标题" value={fields.title}
        onChange={event => setField('title', event.target.value)} className={TITLE_INPUT} />
      {canEdit && parentItems.length > 0 && <div className={FIELD_ROW}>
        <span className={FIELD_LABEL}>父词条</span>
        <RelatedItemsSelector items={parentItems} selectedIds={selectedParentIds} maxItems={1}
          placeholder="搜索父词条" onChange={ids => setField('parentId', ids[0] ?? null)} />
      </div>}
      <SummaryBlock value={fields.summary} onChange={value => setField('summary', value)} />
    </fieldset>
    <NoteRelationFields entry={snapshot.entity} links={links} relations={fields.relations}
      onChange={canModify ? value => setField('relations', value) : undefined}
      onNavigate={disabled ? undefined : onNavigate} />
    <GalleryBlock title="相册" images={fields.gallery.map(image => image.url)}
      onAdd={canModify ? url => setFields(previous => ({ ...previous, gallery: [...previous.gallery, { url, caption: '' }] })) : undefined}
      onReplace={canModify ? (index, url) => setFields(previous => ({
        ...previous, gallery: previous.gallery.map((image, i) => i === index ? { ...image, url } : image),
      })) : undefined}
      onRemove={canModify ? index => setFields(previous => ({
        ...previous, gallery: previous.gallery.filter((_, i) => i !== index),
      })) : undefined}
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
      <EditorCore plain imageUploads={false} localReferences={false} referenceItems={references}
        content={worldBodyOf(snapshot.entity)} onReady={onEditorReady} onContentChange={onBodyChange}
        onMentionClick={openReference} onWikiLinkClick={raw => openReference(raw, 'world')} />
    </section>
    <WorkspaceEntityHistory entityId={snapshot.entityId} version={snapshot.version} />
  </div>
}

'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, BookPlus, BookText, FileDown, Plus, Search, Trash2 } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import type { WorldEntry } from '@/types'
import type { WorldTreeNode } from '@/lib/world-tree'
import type { OriginalNoteSnapshot, OriginalNotesCloudAdapter, OriginalNotePatch } from '@/lib/cloud/adapters/original-notes'
import { NOVEL_CATEGORY } from '@/lib/entry-kinds'
import { buildDefaultEntry } from '@/features/world/services'
import { newWorldEntryData } from '@/lib/entity-defaults'
import { CoverCard } from '@/components/shared/cover/CoverCard'
import { CoverFlow } from '@/components/shared/CoverFlow'
import { SortViewControls, normalizeViewMode, type ViewMode } from '@/components/shared/SortViewControls'
import { TreeRow } from '@/components/shared/TreeRow'
import { EditorCore } from '@/components/editor/EditorCore'
import { WorkspaceEntityHistory } from '@/components/cloud/WorkspaceEntityHistory'
import { insertWorkspaceBodyImage, useWorkspaceDraftGuard, useWorkspaceImageUpload } from '@/components/cloud/workspace-editor-guards'
import { registerPendingSave } from '@/lib/pending-saves'
import { docRevisionChanged } from '@/lib/save-revision'
import { hasNewBodyImages } from '@/lib/cloud/character-media'
import { worldBodyOf, worldBodyPatch } from '@/lib/world-body'
import { flattenNovel, toMarkdown, toTxt, countNovelWords } from '@/features/novel/export'
import { downloadNovelDocx } from '@/features/novel/docx'
import { paginateNovel } from '@/features/novel/pagination'
import { DEFAULT_NOVEL_LAYOUT, toPaginateOptions } from '@/features/novel/layout'
import { resolveNovelBackground } from '@/features/novel/background'
import { saveBlobAs } from '@/features/map/export'
import { cloudNovelBooks, novelChapterTree, novelSubtree, safeNovelFileName } from './cloud-novel-projection'
import { BTN_PRIMARY, BTN_QUIET, FIELD_INPUT, FIELD_LABEL, FIELD_ROW, TITLE_INPUT } from '@/lib/ui-tokens'

const NovelReader = dynamic(() => import('@/features/novel/NovelReader').then(module => module.NovelReader), { ssr: false })

type MutableNovelProps = {
  adapter: OriginalNotesCloudAdapter
  canEdit: boolean
  disabled: boolean
  onSaved: (snapshot: OriginalNoteSnapshot) => void
}
export interface WorkspaceNovelProps extends MutableNovelProps {
  workspaceId: string
  notes: OriginalNoteSnapshot[]
  loading: boolean
  error?: string | null
  onCreated: (snapshot: OriginalNoteSnapshot) => void
  onRefresh: () => Promise<void>
}

function rootFields(row: WorldEntry) {
  return {
    title: row.title, novelAuthor: row.novelAuthor ?? '', novelSynopsis: row.novelSynopsis ?? '',
    novelNotes: row.novelNotes ?? '', novelTargetWords: row.novelTargetWords ?? 0,
    novelCover: row.novelCover ?? '',
  }
}

/** Original novel's work-information form persisted via expected-version cloud snapshots. */
function CloudBookInfo({ snapshot, adapter, canEdit, disabled, onSaved }: MutableNovelProps & {
  snapshot: OriginalNoteSnapshot
}) {
  const [draft, setDraft] = useState(() => rootFields(snapshot.entity))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const baseline = useRef(snapshot)
  const inFlight = useRef<Promise<void> | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(rootFields(baseline.current.entity))
  const writable = canEdit && !disabled && !busy
  const draftRef = useRef(draft)
  draftRef.current = draft

  const save = useCallback(async (override?: Partial<typeof draft>) => {
    if (inFlight.current) return inFlight.current
    const fields = { ...draftRef.current, ...override }
    const current = baseline.current
    const before = rootFields(current.entity)
    const patch: OriginalNotePatch = {}
    for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
      if (fields[key] === before[key]) continue
      if (key === 'novelTargetWords') Object.assign(patch, { novelTargetWords: fields[key] || null })
      else Object.assign(patch, { [key]: fields[key] })
    }
    if (Object.keys(patch).length === 0) return
    setBusy(true); setError(null)
    const task = (async () => {
      const next = await adapter.save(current, patch)
      baseline.current = next
      onSaved(next)
    })()
    inFlight.current = task
    try { await task } catch (cause) {
      setError(cause instanceof Error ? cause.message : '作品信息保存失败')
      throw cause
    } finally { inFlight.current = null; setBusy(false) }
  }, [adapter, onSaved])

  useEffect(() => registerPendingSave(() => {
    if (inFlight.current) return inFlight.current
    if (dirty && canEdit) return save()
  }), [dirty, canEdit, save])
  useWorkspaceDraftGuard(dirty || busy, '小说作品信息')
  const upload = useWorkspaceImageUpload(snapshot.workspaceId, writable,
    setBusy, setError)

  async function uploadCover(file?: File) {
    if (!file || !writable) return
    const url = await upload(file, file.name)
    if (!url) return
    setDraft(current => ({ ...current, novelCover: url }))
    draftRef.current = { ...draftRef.current, novelCover: url }
    await save({ novelCover: url }).catch(() => undefined)
  }

  return <div className="border-b border-line pb-4">
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-ui font-semibold">作品信息</h3>
      {canEdit && <button type="button" disabled={!writable || !dirty} onClick={() => void save().catch(() => undefined)}
        className={BTN_QUIET}>{busy ? '保存中…' : dirty ? '保存作品信息' : '已保存'}</button>}
    </div>
    {error && <p role="alert" className="text-ui text-error">{error}
      <textarea readOnly aria-label="未保存的作品信息" className="mt-1 w-full" value={JSON.stringify(draft)} />
    </p>}
    <fieldset disabled={!canEdit || disabled || busy} className="grid gap-3 sm:grid-cols-2">
      <label className={FIELD_ROW}><span className={FIELD_LABEL}>书名</span>
        <input aria-label="小说书名" value={draft.title}
          onChange={event => setDraft(row => ({ ...row, title: event.target.value }))} className={FIELD_INPUT} />
      </label>
      <label className={FIELD_ROW}><span className={FIELD_LABEL}>作者</span>
        <input aria-label="小说作者" value={draft.novelAuthor}
          onChange={event => setDraft(row => ({ ...row, novelAuthor: event.target.value }))} className={FIELD_INPUT} />
      </label>
      <label className={FIELD_ROW}><span className={FIELD_LABEL}>目标字数</span>
        <input aria-label="目标字数" type="number" min="0" value={draft.novelTargetWords}
          onChange={event => setDraft(row => ({ ...row, novelTargetWords: Math.max(0, Number(event.target.value) || 0) }))} className={FIELD_INPUT} />
      </label>
      <label className={FIELD_ROW}><span className={FIELD_LABEL}>封面</span>
        <input type="file" aria-label="上传小说封面" accept="image/png,image/jpeg,image/webp"
          onChange={event => {const file=event.target.files?.[0];event.target.value='';void uploadCover(file)}} className="min-w-0 w-full text-caption" />
      </label>
      <label className="flex flex-col gap-1 text-ui"><span>简介</span>
        <textarea aria-label="小说简介" rows={2} value={draft.novelSynopsis}
          onChange={event => setDraft(row => ({ ...row, novelSynopsis: event.target.value }))}
          className="w-full rounded-control border border-line bg-paper p-2" />
      </label>
      <label className="flex flex-col gap-1 text-ui"><span>笔记</span>
        <textarea aria-label="小说笔记" rows={2} value={draft.novelNotes}
          onChange={event => setDraft(row => ({ ...row, novelNotes: event.target.value }))}
          className="w-full rounded-control border border-line bg-paper p-2" />
      </label>
    </fieldset>
    <WorkspaceEntityHistory entityId={snapshot.entityId} version={snapshot.version} />
  </div>
}

/** Original Tiptap editor and chapter outline with the same cloud save pipeline as notes. */
function CloudChapterEditor({ snapshot, adapter, onSaved, canEdit, disabled }: MutableNovelProps & {
  snapshot: OriginalNoteSnapshot
}) {
  const baseline = useRef(snapshot)
  const [title, setTitle] = useState(snapshot.entity.title)
  const [outline, setOutline] = useState(snapshot.entity.chapterOutline ?? '')
  const [bodyTick, setBodyTick] = useState(0)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const editor = useRef<Editor | null>(null)
  const bodyBaseline = useRef<Editor['state']['doc'] | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const fields = useRef({title,outline})
  fields.current={title,outline}
  const bodyDirty = Boolean(editor.current?.state.doc && bodyBaseline.current &&
    docRevisionChanged(editor.current.state.doc, bodyBaseline.current))
  const dirty = title !== baseline.current.entity.title ||
    outline !== (baseline.current.entity.chapterOutline ?? '') || bodyDirty
  const writable = canEdit && !disabled
  const canWrite = writable && !saving
  const save = useCallback(async () => {
    if (!writable) return
    if (inFlight.current) return inFlight.current
    const current = baseline.current
    const patch: OriginalNotePatch = {}
    if (fields.current.title.trim() && fields.current.title !== current.entity.title) patch.title=fields.current.title.trim()
    if (fields.current.outline !== (current.entity.chapterOutline ?? '')) patch.chapterOutline=fields.current.outline
    const doc = editor.current?.state.doc
    if (doc && bodyBaseline.current && docRevisionChanged(doc, bodyBaseline.current)) {
      const body = doc.toJSON()
      if (hasNewBodyImages(worldBodyOf(current.entity), body)) throw new Error('请使用正文上传按钮添加图片')
      Object.assign(patch, worldBodyPatch(body))
    }
    if (!Object.keys(patch).length) return
    setSaving(true);setError(null)
    const task = (async () => {
      const next = await adapter.save(current, patch)
      baseline.current=next
      if (doc) bodyBaseline.current=doc
      onSaved(next)
      setRevision(value=>value+1)
    })()
    inFlight.current=task
    try {await task} catch(cause){
      setError(cause instanceof Error ? cause.message : '章节保存失败')
      throw cause
    } finally{inFlight.current=null;setSaving(false)}
  },[adapter,onSaved,writable])

  useEffect(() => registerPendingSave(() => {
    if (inFlight.current) return inFlight.current
    if (dirty && writable) return save()
  }), [dirty, writable, save])
  useWorkspaceDraftGuard(dirty || saving, '小说章节')

  const upload = useWorkspaceImageUpload(snapshot.workspaceId, canWrite, setSaving, setError)
  const fileChange = (file: File | undefined) => {
    const ready = editor.current
    if (file && ready) void upload(file, file.name, url => insertWorkspaceBodyImage(ready, url))
  }

  useEffect(() => {
    if (!dirty || !writable || saving) return
    const timeout=window.setTimeout(() => {void save().catch(() => undefined)}, 1800)
    return()=>window.clearTimeout(timeout)
  },[title,outline,bodyTick,dirty,writable,saving,save,revision])

  return <article className="min-w-0 flex-1">
    <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <span className="text-caption text-ink-faint">{saving ? '保存中…' : dirty ? '未保存' : '已保存'}</span>
      {canEdit && <button className={BTN_PRIMARY} type="button"
        onClick={() => void save().catch(() => undefined)} disabled={!canWrite || !dirty || !title.trim()}>保存章节</button>}
    </header>
    {error && <div role="alert" className="text-ui text-error">{error}
      <textarea aria-label="未保存章节草稿" readOnly className="mt-2 w-full"
        value={JSON.stringify({ title, outline, document: editor.current?.getJSON() ?? null },null,2)} />
    </div>}
    <fieldset disabled={!canWrite} className="flex flex-col gap-2">
      <input aria-label="章节标题" className={TITLE_INPUT} value={title} onChange={event=>setTitle(event.target.value)} />
      <label className={FIELD_ROW}><span className={FIELD_LABEL}>大纲</span>
        <input aria-label="章节大纲" className={FIELD_INPUT} value={outline}
          onChange={event => setOutline(event.target.value)} placeholder="一句话概括本章" />
      </label>
    </fieldset>
    <p className="my-3 text-right text-caption text-ink-faint">
      本章 {countNovelWords(flattenNovel([{ ...snapshot.entity, title, document: editor.current?.getJSON() ?? snapshot.entity.document }]))} 字
    </p>
    {canEdit && <label className={BTN_QUIET}>上传正文图片
      <input type="file" className="sr-only" aria-label="上传小说正文图片"
        accept="image/png,image/jpeg,image/webp,image/gif" disabled={!canWrite}
        onChange={event => {const file=event.target.files?.[0];event.target.value='';fileChange(file)}} />
    </label>}
    <EditorCore plain imageUploads={false} localReferences={false}
      content={worldBodyOf(snapshot.entity)} onReady={value=>{
        editor.current=value
        bodyBaseline.current=value.state.doc
        value.setEditable(writable)
      }} onContentChange={()=>setBodyTick(value=>value+1)} />
    <WorkspaceEntityHistory entityId={snapshot.entityId} version={snapshot.version} />
  </article>
}

function ChapterNode({ node, depth, selectedId, onSelect, canEdit, busy,
  onCreateChild, onDelete }: {
  node: WorldTreeNode; depth: number; selectedId: number | null
  onSelect: (id:number)=>void; canEdit:boolean; busy:boolean
  onCreateChild:(id:number)=>void; onDelete:(id:number)=>void
}) {
  const [expanded, setExpanded] = useState(true)
  return <li>
    <TreeRow depth={depth} selected={node.entry.id===selectedId} title={node.entry.title}
      icon={<BookText size={12}/>} onClick={()=>onSelect(node.entry.id)}
      expanded={node.children.length ? expanded : undefined}
      onToggleExpand={()=>setExpanded(value=>!value)}
      actions={canEdit && !busy ? <div className="flex items-center gap-1">
        <button type="button" title="新建子章节" aria-label="新建子章节"
          onClick={event=>{event.stopPropagation();onCreateChild(node.entry.id)}}><Plus size={13}/></button>
        <button type="button" title="删除章节及子级" aria-label="删除章节"
          onClick={event=>{event.stopPropagation();onDelete(node.entry.id)}}><Trash2 size={13}/></button>
      </div> : undefined}/>
    {expanded && node.children.length>0 && <ul>
      {node.children.map(child=><ChapterNode key={child.entry.id} node={child} depth={depth+1}
        selectedId={selectedId} onSelect={onSelect} canEdit={canEdit} busy={busy}
        onCreateChild={onCreateChild} onDelete={onDelete}/>)}
    </ul>}
  </li>
}

export function WorkspaceNovel(props: WorkspaceNovelProps) {
  const [activeBookId,setActiveBookId]=useState<number|null>(null)
  const [activeChapterId,setActiveChapterId]=useState<number|null>(null)
  const [view,setView]=useState<ViewMode>('gallery')
  const [sort,setSort]=useState<'default'|'name'>('default')
  const [query,setQuery]=useState('')
  const [preview,setPreview]=useState(false)
  const [format,setFormat]=useState<'9:16'|'16:9'|'A4'>('9:16')
  const [error,setError]=useState<string|null>(null)
  const [busy,setBusy]=useState(false)
  const [uploading,setUploading]=useState(false)
  const [deleting,setDeleting]=useState(false)
  const pending=useRef<Promise<void>|null>(null)
  const writable=props.canEdit&&!props.disabled&&!busy&&!props.loading

  const entries=useMemo(()=>props.notes.map(row=>row.entity).filter(row=>row.category===NOVEL_CATEGORY),[props.notes])
  const books=useMemo(()=>cloudNovelBooks(entries),[entries])
  const filteredBooks=useMemo(()=> {
    const rows=books.filter(book=>!query.trim()||book.title.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()))
    return sort==='name'?[...rows].sort((a,b)=>a.title.localeCompare(b.title,'zh-Hans')):rows
  },[books,query,sort])
  const root=props.notes.find(row=>row.entity.id===activeBookId&&row.entity.category===NOVEL_CATEGORY)??null
  const chapters=useMemo(()=>activeBookId!==null
    ? novelSubtree(entries,activeBookId).filter(row=>row.id!==activeBookId) : [],[entries,activeBookId])
  const chapterTree=useMemo(()=>activeBookId!==null?novelChapterTree(entries,activeBookId):[],[entries,activeBookId])
  const selected=props.notes.find(row=>row.entity.id===activeChapterId&&row.entity.category===NOVEL_CATEGORY)??null
  const exported=useMemo(()=>flattenNovel(chapters),[chapters])
  const readingMeta={title:root?.entity.title??'小说',author:root?.entity.novelAuthor??'',
    synopsis:root?.entity.novelSynopsis??''}
  const pages=useMemo(()=>paginateNovel(exported,toPaginateOptions(DEFAULT_NOVEL_LAYOUT,format,readingMeta)),
    [exported,format,readingMeta.title,readingMeta.author,readingMeta.synopsis])

  useEffect(()=>registerPendingSave(()=>pending.current??undefined),[])
  useWorkspaceDraftGuard(busy||uploading, '小说')

  async function write(fn:()=>Promise<void>) {
    if(!writable||pending.current) return
    setBusy(true);setError(null)
    const task=fn()
    pending.current=task
    try{await task}catch(cause){setError(cause instanceof Error?cause.message:'小说操作失败')}
    finally{pending.current=null;setBusy(false)}
  }

  function create(parentId:number|null) {
    void write(async()=>{
      const order=entries.reduce((max,row)=>Math.max(max,row.order??0),0)+1
      const title=parentId==null?'新小说':'新章节'
      const entry=buildDefaultEntry({ ...newWorldEntryData(), title,
        category:NOVEL_CATEGORY,parentId,order })
      const result=await props.adapter.create(entry)
      props.onCreated(result)
      if(parentId==null){setActiveBookId(result.entity.id);setActiveChapterId(null)}
      else setActiveChapterId(result.entity.id)
      setPreview(false)
    })
  }

  function openBook(id:number) {
    setActiveBookId(id)
    const chapter=novelSubtree(entries,id).filter(row=>row.id!==id)
      .sort((a,b)=>(a.order??0)-(b.order??0))[0]
    setActiveChapterId(chapter?.id??null)
    setPreview(false)
  }

  async function remove(id:number) {
    const target=props.notes.find(row=>row.entity.id===id&&row.entity.category===NOVEL_CATEGORY)
    if (!target || !writable || deleting) return
    const children=novelSubtree(entries,id)
    if (!window.confirm(`确认将「${target.entity.title}」和所属 ${children.length-1} 条子章节移入回收站？`)) return
    setDeleting(true)
    await write(async()=>{
      const response=await fetch('/api/workspaces/'+props.workspaceId+'/novels/'+target.entityId,{
        method:'DELETE',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({expectedVersion:target.version})
      })
      if(!response.ok){
        const body:{error?:string}=await response.json().catch(()=>({}))
        throw new Error(body.error==='VERSION_CONFLICT'?'章节已由其他成员修改，请刷新':body.error??'删除失败')
      }
      await props.onRefresh()
      if(activeBookId===id){setActiveBookId(null);setActiveChapterId(null)}
      else if(chapters.some(row=>row.id===id)||activeChapterId===id) setActiveChapterId(null)
    })
    setDeleting(false)
  }

  async function download(format:'txt'|'md'|'docx'){
    if(!root)return
    setError(null);setBusy(true)
    const name=safeNovelFileName(root.entity.title)
    try{
      if(format==='docx'){
        await downloadNovelDocx(exported,{title:root.entity.title,author:root.entity.novelAuthor,
          synopsis:root.entity.novelSynopsis, coverSrc:root.entity.novelCover},name)
      }else{
        const text=format==='txt'?toTxt(exported,{title:root.entity.title}):
          toMarkdown(flattenNovel(chapters,{markdown:true}),{title:root.entity.title})
        await saveBlobAs(new Blob([text],{type:format==='txt'?'text/plain;charset=utf-8':'text/markdown;charset=utf-8'}),
          name+'.'+format,{filterName:'小说'})
      }
    }catch(cause){setError(cause instanceof Error?cause.message:'导出失败')}
    finally{setBusy(false)}
  }

  if(!root) return <section className="flex min-w-0 flex-col gap-4 border-t border-line pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-serif text-lg font-semibold">小说</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="搜索小说" value={query} onChange={event=>setQuery(event.target.value)}
          placeholder="搜索书名" className="w-36 border-b border-line bg-transparent px-2 py-1 text-ui"/>
        <SortViewControls viewMode={view} onViewModeChange={setView} sortKey={sort}
          onSortChange={key=>setSort(key==='name'?'name':'default')}
          sortOptions={[{label:'默认顺序',value:'default'},{label:'按名称',value:'name'}]}/>
        {props.canEdit&&<button type="button" className={BTN_PRIMARY} disabled={!writable}
          onClick={()=>create(null)}><BookPlus size={14}/>新建小说</button>}
      </div>
    </div>
    {props.error&&<p role="alert" className="text-error text-ui">{props.error}</p>}
    {error&&<p role="alert" className="text-error text-ui">{error}</p>}
    {props.loading?<p className="text-ui text-ink-faint">正在读取小说…</p>
      :filteredBooks.length===0?<p className="rounded-panel border border-dashed border-line p-8 text-center text-ui text-ink-faint">还没有小说</p>
      :view==='list'?<ul className="divide-y divide-line">{filteredBooks.map(book=><li key={book.id}
        className="flex items-center justify-between gap-3 py-3">
        <button type="button" onClick={()=>openBook(book.id)} className="min-w-0 flex-1 text-left text-ui">
          {book.title}<span className="ml-3 text-caption text-ink-faint">{book.chapters} 章 · {book.words} 字</span>
        </button>{props.canEdit&&<button type="button" aria-label={'删除'+book.title}
          onClick={()=>void remove(book.id)}><Trash2 size={14}/></button>}
        </li>)}</ul>
      :<div className={view==='grid'?'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4':''}>
        {view==='gallery'?<CoverFlow itemWidth={230}>
          {filteredBooks.map(book=><CoverCard key={book.id} id={book.id} title={book.title}
            meta={book.chapters+' 章 · '+book.words+' 字'} imageSrc={book.cover}
            aspect={2/3} photoHeight={100} isMobile={false} onSelect={()=>openBook(book.id)}/>)}
        </CoverFlow>:filteredBooks.map(book=><CoverCard key={book.id} id={book.id} title={book.title}
          meta={book.chapters+' 章 · '+book.words+' 字'} imageSrc={book.cover}
          aspect={2/3} photoHeight={100} isMobile={false} onSelect={()=>openBook(book.id)}/>)}
      </div>}
  </section>

  return <section className="flex min-w-0 flex-col gap-4 border-t border-line pt-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" className={BTN_QUIET} onClick={()=>{setActiveBookId(null);setActiveChapterId(null);setPreview(false)}}>← 书架</button>
      <span className="font-serif text-lg font-semibold">{root.entity.title}</span>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={BTN_QUIET} onClick={()=>setPreview(value=>!value)}>
          {preview?'返回编辑':'分页预览'}</button>
        <select aria-label="阅读纸张" value={format} onChange={event=>setFormat(event.target.value as typeof format)}
          className="border-b border-line bg-transparent px-1 text-ui">
          <option value="9:16">9:16</option><option value="16:9">16:9</option><option value="A4">A4</option>
        </select>
        <button type="button" className={BTN_QUIET} onClick={()=>void download('txt')} disabled={busy}>TXT</button>
        <button type="button" className={BTN_QUIET} onClick={()=>void download('md')} disabled={busy}>Markdown</button>
        <button type="button" className={BTN_QUIET} onClick={()=>void download('docx')} disabled={busy}><FileDown size={14}/>Word</button>
      </div>
    </div>
    {error&&<p role="alert" className="text-ui text-error">{error}</p>}
    {preview?<div className="h-[75vh] min-h-[400px] overflow-hidden rounded-panel border border-line">
      <NovelReader pages={pages} format={format} layout={DEFAULT_NOVEL_LAYOUT}
        background={resolveNovelBackground('paper')} meta={readingMeta} />
    </div>:<div className="grid min-w-0 gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="min-w-0 rounded-panel border border-line bg-paper-alt p-3">
        <div className="mb-3 flex items-center justify-between">
          <strong className="text-ui">章节目录</strong>
          {props.canEdit&&<button type="button" title="添加章节" disabled={!writable}
            onClick={()=>create(activeBookId)}><Plus size={15}/></button>}
        </div>
        <div className="mb-2 flex items-center gap-1 border-b border-line"><Search size={12}/>
          <input value={query} aria-label="搜索章节" onChange={event=>setQuery(event.target.value)}
            placeholder="搜索章节" className="min-w-0 w-full bg-transparent px-1 py-1 text-ui" />
        </div>
        <ul>{chapterTree.filter(node=>!query.trim()||node.entry.title.includes(query)).map(node=>
          <ChapterNode key={node.entry.id} node={node} depth={0} selectedId={activeChapterId}
            onSelect={setActiveChapterId} canEdit={props.canEdit} busy={busy}
            onCreateChild={create} onDelete={id=>void remove(id)} />)}</ul>
        {chapterTree.length===0&&<p className="text-caption text-ink-faint">暂无章节</p>}
        <p className="mt-3 text-caption text-ink-faint">{chapters.length} 章 · {countNovelWords(exported)} 字</p>
      </aside>
      <div className="min-w-0">
        <CloudBookInfo key={root.entityId} snapshot={root} adapter={props.adapter}
          onSaved={props.onSaved} canEdit={props.canEdit} disabled={props.disabled} />
        {selected?<CloudChapterEditor key={selected.entityId} snapshot={selected} adapter={props.adapter}
          onSaved={props.onSaved} canEdit={props.canEdit} disabled={props.disabled} />:
          <div className="p-8 text-center text-ui text-ink-faint">
            选择章节开始写作
            {props.canEdit&&<button type="button" className={BTN_PRIMARY} disabled={!writable}
              onClick={()=>create(activeBookId)}><Plus size={13}/>新建第一章</button>}
          </div>}
      </div>
    </div>}
  </section>
}

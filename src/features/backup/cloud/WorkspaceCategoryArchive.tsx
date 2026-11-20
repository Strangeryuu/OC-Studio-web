'use client'

import { useEffect, useState } from 'react'
import { Archive, FileUp, FolderDown, ShieldCheck } from 'lucide-react'
import { BTN_PRIMARY, BTN_QUIET, INPUT_LINE } from '@/lib/ui-tokens'
import { parseCategoryArchive, type CategoryArchive, type CategoryKind,
  type CategoryStrategy } from '@/lib/cloud/category-archive'

type Scopes={
  counts:Record<CategoryKind,number>
  folders:string[]
  categories:string[]
}
type Preview={
  sourceName:string;kind:CategoryKind;selected:number;total:number
  context:number;media:number;duplicates:number;addable:number
}
const KINDS:{value:CategoryKind;label:string}[]=[
  {value:'character',label:'角色'},
  {value:'event',label:'事件'},
  {value:'country',label:'国家'},
  {value:'worldEntry',label:'世界词条 / 自定义分类'},
]
const ERROR_MESSAGES:Record<string,string>={
  CATEGORY_INVALID:'分类文件格式无效，或与当前 Web 版本的格式不兼容',
  CATEGORY_INVALID_SELECTION:'请选择要导出的分类',
  CATEGORY_EMPTY:'当前选择中没有可导出的内容',
  CATEGORY_TOO_LARGE:'数据或图片超过分类归档大小限制，可缩小范围后重试',
  CATEGORY_REFERENCE_MISSING:'部分关联对象已被删除或缺失，请修复关联后重试',
  CATEGORY_REFERENCE_INVALID:'关联关系不完整或数据格式不符合要求',
  CATEGORY_MEDIA_INVALID:'归档中的图片不符合允许的格式',
  CATEGORY_MEDIA_MISSING:'部分图片缺失，已取消本次操作',
  CATEGORY_AMBIGUOUS_SOURCE:'源文件中存在无法自动判断的重复名称',
  CATEGORY_AMBIGUOUS_TARGET:'目标世界观存在多个同名条目，请先整理重复名称',
  CATEGORY_CUSTOMIZATION_INVALID:'目标分类配置无效，请先检查世界观分类设置',
  CATEGORY_CUSTOMIZATION_LIMIT:'目标分类数量已达上限，请先整理分类',
  CATEGORY_FOLDER_INVALID:'现有角色分组清单损坏，请先检查分组设置',
  CATEGORY_FOLDER_LIMIT:'目标角色分组数量已达上限',
  CATEGORY_TAG_INVALID:'标签关联无效，请先检查源世界观标签',
  CATEGORY_OPERATION_FAILED:'操作未完成，数据未写入，请检查日志后重试',
}
function message(error:unknown) {
  const code=error instanceof Error?error.message:String(error)
  return ERROR_MESSAGES[code]??code
}
async function readJson<T>(response:Response):Promise<T> {
  const data=await response.json() as T & {error?:string}
  if(!response.ok)throw new Error(data.error??'请求失败')
  return data
}
function saveArchive(blob:Blob,name:string) {
  const url=URL.createObjectURL(blob)
  const anchor=document.createElement('a')
  anchor.href=url
  anchor.download=name.replace(/[\\/:*?"<>|]+/g,'-').slice(0,95)+'.ocbak'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),60000)
}

export function WorkspaceCategoryArchive({workspaceId,workspaceName,canExport,canImport,onImported}:{
  workspaceId:string;workspaceName:string;canExport:boolean;canImport:boolean
  onImported:()=>Promise<void>
}) {
  const [scope,setScope]=useState<Scopes|null>(null)
  const [kind,setKind]=useState<CategoryKind>('character')
  const [filter,setFilter]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [result,setResult]=useState('')
  const [pending,setPending]=useState<CategoryArchive|null>(null)
  const [preview,setPreview]=useState<Preview|null>(null)
  const [strategy,setStrategy]=useState<CategoryStrategy>('skip')
  const [acknowledged,setAcknowledged]=useState(false)

  useEffect(()=>{
    if(!canExport)return
    let mounted=true
    void fetch('/api/workspaces/'+workspaceId+'/category-archive?mode=options',{cache:'no-store'})
      .then(response=>readJson<Scopes>(response))
      .then(data=>{if(mounted)setScope(data)})
      .catch(cause=>{if(mounted)setError(message(cause))})
    return()=>{mounted=false}
  },[workspaceId,canExport])
  const options=kind==='character'?scope?.folders??[]:kind==='worldEntry'?scope?.categories??[]:[]
  const base='/api/workspaces/'+workspaceId+'/category-archive'

  const exportSelected=async()=>{
    if(busy||!canExport)return
    setBusy(true);setError('');setResult('')
    try {
      const params=new URLSearchParams({kind})
      if(filter&&kind==='character')params.set('folder',filter)
      if(filter&&kind==='worldEntry')params.set('category',filter)
      const response=await fetch(base+'?'+params.toString(),{cache:'no-store'})
      if(!response.ok) {
        const body=await response.json() as {error?:string}
        throw new Error(body.error??'导出失败')
      }
      const blob=await response.blob()
      saveArchive(blob,'OC-Studio-'+workspaceName+'-'+KINDS.find(x=>x.value===kind)?.label+'-'+
        new Date().toISOString().slice(0,10))
      setResult('分类文件已生成，包含选中条目、必要的关联对象与私有图片。')
    } catch(cause){setError(message(cause))}
    finally{setBusy(false)}
  }
  const prepareImport=async(file:File|undefined)=>{
    if(!file||!canImport||busy)return
    setError('');setResult('');setPending(null);setPreview(null)
    if(file.size>40_000_000) {
      setError('分类文件大小超过 40 MB，请缩小导出范围');return
    }
    setBusy(true)
    try {
      const archive=parseCategoryArchive(JSON.parse(await file.text()) as unknown)
      if(!archive)throw new Error('CATEGORY_INVALID')
      const info=await readJson<Preview>(await fetch(base,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'preview',archive}),
      }))
      setPending(archive);setPreview(info);setStrategy('skip');setAcknowledged(false)
    } catch(cause){setError(message(cause))}
    finally{setBusy(false)}
  }
  const applyImport=async()=>{
    if(!pending||!preview||!acknowledged||!canImport||busy)return
    setBusy(true);setError('');setResult('')
    try {
      const outcome=await readJson<{added:number;skipped:number;renamed:number;media:number}>(
        await fetch(base,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({action:'import',archive:pending,strategy}),
        }),
      )
      setPending(null);setPreview(null);setAcknowledged(false)
      setResult('导入完成：新增 '+outcome.added+' 条，跳过 '+outcome.skipped+
        ' 条，重命名 '+outcome.renamed+' 条，导入图片 '+outcome.media+' 张。')
      await onImported()
    } catch(cause){setError(message(cause))}
    finally{setBusy(false)}
  }

  return <section className="flex min-w-0 flex-col gap-4 border-t border-line pt-5">
    <div className="flex items-start gap-3">
      <span className="rounded-panel border border-line p-2 text-ink"><Archive size={20}/></span>
      <div>
        <h2 className="text-reading font-semibold">分类归档 · 跨世界观迁移</h2>
        <p className="mt-1 text-caption leading-relaxed text-ink-muted">
          借鉴 OC-editor 分类备份操作方式，导出角色、事件、国家及世界词条。
          关联对象会一起打包，导入时重新分配 ID。当前支持 OC Studio Web 分类格式。
        </p>
      </div>
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-panel border border-line p-4">
        <h3 className="font-medium text-ui">选择范围并导出</h3>
        <label className="mt-3 block text-caption text-ink-muted">
          资料类型
          <select value={kind} onChange={event=>{setKind(event.target.value as CategoryKind);setFilter('')}}
            className={INPUT_LINE+' mt-1 h-9 w-full'} disabled={busy||!canExport}>
            {KINDS.map(item=><option key={item.value} value={item.value}>
              {item.label}{scope?' · '+scope.counts[item.value]+' 条':''}
            </option>)}
          </select>
        </label>
        {(kind==='character'||kind==='worldEntry')&&<label className="mt-3 block text-caption text-ink-muted">
          {kind==='character'?'角色分组':'词条分类'}
          <select value={filter} onChange={event=>setFilter(event.target.value)}
            className={INPUT_LINE+' mt-1 h-9 w-full'} disabled={busy||!canExport}>
            <option value="">全部{kind==='character'?'角色':'词条'}</option>
            {options.map(value=><option key={value} value={value}>{value}</option>)}
          </select>
        </label>}
        <button type="button" className={BTN_PRIMARY+' mt-4'} disabled={!canExport||busy}
          onClick={()=>void exportSelected()}><FolderDown size={16}/>
          {busy?'处理中…':'下载分类 .ocbak'}
        </button>
      </div>
      <div className="rounded-panel border border-line p-4">
        <h3 className="font-medium text-ui">增量导入</h3>
        <p className="mt-2 text-caption leading-relaxed text-ink-muted">
          可以导入已有内容的世界观，自动识别同类别、同名称条目。
          先检查重复数量，再选择处理方式。原有整库恢复功能保持不变。
        </p>
        {canImport?<label className={BTN_QUIET+' mt-4 inline-flex cursor-pointer'}>
          <FileUp size={16}/>选择分类 .ocbak
          <input type="file" accept=".ocbak,application/json" className="sr-only" disabled={busy}
            aria-label="选择分类归档"
            onChange={event=>{const file=event.target.files?.[0];event.target.value='';void prepareImport(file)}}/>
        </label>:<p className="mt-4 text-caption text-ink-faint">仅世界观所有者或管理员可以导入。</p>}
      </div>
    </div>
    {preview&&pending&&<div className="rounded-panel border border-line bg-paper-card p-4">
      <div className="flex items-center gap-2"><ShieldCheck size={17}/>
        <h3 className="text-ui font-semibold">确认导入内容</h3>
      </div>
      <p className="mt-2 text-caption text-ink-muted">
        来源：{preview.sourceName||'未知世界观'}。
        主要条目 {preview.selected} 条，关联对象 {preview.context} 条，
        图片 {preview.media} 张，目标同名条目 {preview.duplicates} 条。
      </p>
      <fieldset className="mt-3 flex flex-col gap-2 text-caption">
        <legend className="mb-2 font-medium">重复条目处理方式</legend>
        <label className="flex items-center gap-2"><input type="radio" name="category-import-strategy"
          checked={strategy==='skip'} onChange={()=>setStrategy('skip')}/>
          跳过同名条目（保留现有数据，新增其他内容）
        </label>
        <label className="flex items-center gap-2"><input type="radio" name="category-import-strategy"
          checked={strategy==='keep-both'} onChange={()=>setStrategy('keep-both')}/>
          保留两者（新条目添加“导入”后缀，关联重新映射）
        </label>
      </fieldset>
      <label className="mt-3 flex items-start gap-2 text-caption leading-relaxed">
        <input type="checkbox" className="mt-1" checked={acknowledged}
          onChange={event=>setAcknowledged(event.target.checked)}/>
        已核对来源与目标世界观，确认将数据写入当前世界观
      </label>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={BTN_PRIMARY}
          disabled={!acknowledged||busy} onClick={()=>void applyImport()}>
          {busy?'导入中…':'确认导入'}
        </button>
        <button type="button" className={BTN_QUIET} disabled={busy}
          onClick={()=>{setPending(null);setPreview(null);setAcknowledged(false)}}>取消</button>
      </div>
    </div>}
    {error&&<p role="alert" className="text-caption text-error">{error}</p>}
    {result&&<p role="status" className="text-caption text-ink-muted">{result}</p>}
  </section>
}

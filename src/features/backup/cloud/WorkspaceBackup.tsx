'use client'
import { useState } from 'react'
import { Download, Upload, DatabaseBackup } from 'lucide-react'
import { BTN_PRIMARY, BTN_QUIET } from '@/lib/ui-tokens'
import { WorkspaceCategoryArchive } from './WorkspaceCategoryArchive'

export function WorkspaceBackup({workspaceId,workspaceName,canExport,canImport,onImported}:{
  workspaceId:string;workspaceName:string;canExport:boolean;canImport:boolean;
  onImported:()=>Promise<void>
}){
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const [report,setReport]=useState<string|null>(null)
  async function exportFile(){
    if(!canExport||busy)return
    setBusy(true);setError(null);setReport(null)
    try{
      const response=await fetch('/api/workspaces/'+workspaceId+'/backup',{cache:'no-store'})
      if(!response.ok){
        const result:{error?:string}=await response.json().catch(()=>({}))
        throw new Error(result.error??'备份导出失败')
      }
      const blob=await response.blob()
      const url=URL.createObjectURL(blob)
      const anchor=document.createElement('a')
      anchor.href=url
      anchor.download='OC-Studio-'+(workspaceName.replace(/[\\/:*?"<>|]/g,'-').slice(0,80)||'世界观')+
        '-'+new Date().toISOString().slice(0,10)+'.ocbak'
      document.body.appendChild(anchor)
      anchor.click();anchor.remove()
      window.setTimeout(()=>URL.revokeObjectURL(url),60000)
      setReport('备份已生成；包含当前世界观的正文、图片、历史记录与模板分类配置。')
    }catch(cause){setError(cause instanceof Error?cause.message:'备份失败')}
    finally{setBusy(false)}
  }
  async function importFile(file:File|undefined){
    if(!file||!canImport||busy)return
    if(file.size>60*1024*1024){
      setError('文件超过 60 MB，请拆分图片或使用其他备份工具');return
    }
    if(!window.confirm('导入将写入当前世界观。仅空资料库支持恢复，已有数据会被保护。继续？'))return
    setBusy(true);setError(null);setReport(null)
    try{
      const response=await fetch('/api/workspaces/'+workspaceId+'/backup',{
        method:'POST',headers:{'Content-Type':'application/json'},body:await file.text(),
      })
      const result:{error?:string;restored?:number;media?:number;tags?:number;
        source?:string;warning?:string}=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(result.error==='RESTORE_TARGET_NOT_EMPTY'
        ?'目标世界观已经存在数据。请新建空白世界观后导入，以保护已有内容。':
        result.error??'备份格式或文件内容无效')
      setReport('恢复成功：'+result.restored+' 条记录、'+result.media+' 个媒体文件、'+
        result.tags+' 个标签。'+(result.warning??''))
      await onImported()
    }catch(cause){setError(cause instanceof Error?cause.message:'恢复失败')}
    finally{setBusy(false)}
  }
  return <section className="flex min-w-0 flex-col gap-4 border-t border-line pt-4">
    <div><h2 className="flex items-center gap-2 text-reading font-semibold">
      <DatabaseBackup size={19}/>备份与数据迁移</h2>
      <p className="mt-2 text-ui text-ink-muted">
        导出 .ocbak 单文件；包含世界观内容、私有图片、回收站条目、修改历史、
        标签、模板与自定义分类。可迁移到另一台 VPS 的空白世界观。
      </p>
    </div>
    <div className="rounded-panel border border-line p-4">
      <h3 className="mb-2 text-ui font-semibold">导出世界观</h3>
      <p className="mb-3 text-caption text-ink-muted">
        导出的文件含私人内容，请存放在安全位置。原版桌面支持读取其中的标准 v1 数据段。
      </p>
      <button type="button" className={BTN_PRIMARY} disabled={!canExport||busy}
        onClick={()=>void exportFile()}><Download size={15}/>{busy?'处理中…':'下载 .ocbak 备份'}</button>
    </div>
    <div className="rounded-panel border border-line p-4">
      <h3 className="mb-2 text-ui font-semibold">恢复 / 跨设备迁移</h3>
      <p className="mb-3 text-caption text-ink-muted">
        支持 OC Studio 原版 v1 备份及含 Cloud 数据段的备份。
        恢复时会重新映射实体 ID 与私有媒体地址。为了保护现有数据，目标世界观须为空。
        导入的历史版本会保留内容和顺序，操作者归档到本次导入账号。
      </p>
      {canImport?<label className={BTN_QUIET+' cursor-pointer'}>
        <Upload size={15}/>选择 .ocbak 文件
        <input type="file" accept=".ocbak,application/json" className="sr-only"
          disabled={busy} aria-label="选择 .ocbak 备份"
          onChange={event=>{const file=event.target.files?.[0];event.target.value='';void importFile(file)}}/>
      </label>:<p className="text-caption text-ink-faint">仅世界观所有者或管理员可执行恢复。</p>}
    </div>
    <WorkspaceCategoryArchive workspaceId={workspaceId} workspaceName={workspaceName}
      canExport={canExport} canImport={canImport} onImported={onImported}/>
    {error&&<p role="alert" className="text-ui text-error">{error}</p>}
    {report&&<p role="status" className="text-ui text-ink-muted">{report}</p>}
  </section>
}

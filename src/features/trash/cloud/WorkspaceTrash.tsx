'use client'
import { useCallback, useEffect, useState } from 'react'
import { Trash2, Undo2, RefreshCw } from 'lucide-react'
import { BTN_QUIET, BTN_PRIMARY } from '@/lib/ui-tokens'

type Item = {
  id: string; localId: number; kind: string; category: string | null;
  parentId: number | null; title: string; version: number; deletedAt: string
}
const LABEL: Record<string,string>={character:'角色',country:'国家',event:'事件',worldEntry:'词条'}

export function WorkspaceTrash({workspaceId,canManage,onRestored}:{
  workspaceId:string; canManage:boolean;onRestored:()=>Promise<void>
}){
  const [items,setItems]=useState<Item[]>([])
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState<string|null>(null)
  const [error,setError]=useState<string|null>(null)
  const [next,setNext]=useState<string|null>(null)
  const load=useCallback(async(cursor:string|null=null,append=false)=>{
    setLoading(true);setError(null)
    try{
      const response=await fetch('/api/workspaces/'+workspaceId+'/trash'+
        (cursor?'?after='+encodeURIComponent(cursor):''),{cache:'no-store'})
      const data:{items?:Item[];nextCursor?:string|null;error?:string}=await response.json()
      if(!response.ok||!Array.isArray(data.items))throw new Error(data.error??'回收站加载失败')
      setItems(previous=>append?[...previous,...data.items!]:data.items!)
      setNext(data.nextCursor??null)
    }catch(cause){setError(cause instanceof Error?cause.message:'回收站加载失败')}
    finally{setLoading(false)}
  },[workspaceId])
  useEffect(()=>{void load()},[load])
  async function change(item:Item,permanent:boolean){
    if(!canManage||busy)return
    if(permanent&&!window.confirm('永久删除「'+item.title+'」及其同批删除的子章节？此操作无法撤销。'))return
    setBusy(item.id);setError(null)
    try{
      const response=await fetch('/api/workspaces/'+workspaceId+'/trash/'+item.id,{
        method:permanent?'DELETE':'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({expectedVersion:item.version}),
      })
      const result:{error?:string;items?:number}=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(result.error==='RESTORE_PARENT_MISSING'
        ?'请先恢复父级条目':result.error==='VERSION_CONFLICT'
        ?'条目已被其他成员处理，请刷新后重试':result.error??'操作失败')
      await load()
      await onRestored()
    }catch(cause){setError(cause instanceof Error?cause.message:'操作失败')}
    finally{setBusy(null)}
  }
  return <section className="flex flex-col gap-4 border-t border-line pt-4">
    <div className="flex items-center justify-between gap-2">
      <div>
        <h2 className="text-reading font-semibold">回收站</h2>
        <p className="text-caption text-ink-muted">按资料库隔离；恢复保留原有条目、章节关系与修改历史。</p>
      </div>
      <button type="button" className={BTN_QUIET} disabled={loading||busy!==null}
        onClick={()=>void load()}><RefreshCw size={14}/>刷新</button>
    </div>
    {error&&<p role="alert" className="text-ui text-error">{error}</p>}
    {loading&&items.length===0&&<p className="text-ui text-ink-faint">正在读取回收站…</p>}
    {!loading&&items.length===0&&<p className="rounded-panel border border-dashed border-line p-8 text-center text-ui text-ink-muted">回收站为空</p>}
    <ul className="divide-y divide-line">
      {items.map(item=><li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <p className="truncate text-ui font-medium">{item.title}</p>
          <p className="text-caption text-ink-faint">{item.category??LABEL[item.kind]??item.kind} ·
            {new Date(item.deletedAt).toLocaleString('zh-CN')}
            {item.parentId!=null?' · 含原父级关系':''}</p>
        </div>
        {canManage?<div className="flex items-center gap-2">
          <button type="button" className={BTN_PRIMARY} disabled={busy!==null}
            onClick={()=>void change(item,false)}><Undo2 size={13}/>恢复</button>
          <button type="button" className={BTN_QUIET} disabled={busy!==null}
            onClick={()=>void change(item,true)}><Trash2 size={13}/>永久删除</button>
        </div>:<span className="text-caption text-ink-faint">仅管理员可恢复或清理</span>}
      </li>)}
    </ul>
    {next&&<button type="button" className={BTN_QUIET} disabled={loading||busy!==null}
      onClick={()=>void load(next,true)}>加载更多</button>}
  </section>
}

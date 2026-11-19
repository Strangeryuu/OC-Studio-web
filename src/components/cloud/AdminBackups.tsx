'use client'
import {useEffect,useState} from 'react'
import {DatabaseBackup,Download,RefreshCw,Save} from 'lucide-react'
import type {SiteBackupPolicy,SiteBackupFile} from '@/lib/cloud/server/site-backups'
import {BTN_PRIMARY,BTN_QUIET,FIELD_INPUT} from '@/lib/ui-tokens'

type RecordRow={id:string;name:string}
type Payload={policy:SiteBackupPolicy;version:number;workspaces:RecordRow[];
  files:SiteBackupFile[];workerConfigured:boolean}
const INTERVALS=[
  {hours:1,label:'每小时'},{hours:6,label:'每 6 小时'},
  {hours:12,label:'每 12 小时'},{hours:24,label:'每天'},
  {hours:72,label:'每 3 天'},{hours:168,label:'每周'},{hours:720,label:'每 30 天'},
]
export function AdminBackups(){
  const [payload,setPayload]=useState<Payload|null>(null)
  const [policy,setPolicy]=useState<SiteBackupPolicy|null>(null)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  async function refresh(){
    const response=await fetch('/api/admin/backups',{cache:'no-store'})
    const data=await response.json() as Payload&{error?:string}
    if(!response.ok)throw new Error(data.error||'读取备份配置失败')
    setPayload(data);setPolicy(data.policy)
  }
  useEffect(()=>{void refresh().catch(error=>setMessage(error.message))},[])
  async function save(){
    if(!policy||!payload||busy)return
    setBusy(true);setMessage('')
    try{
      const response=await fetch('/api/admin/backups',{method:'PUT',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({policy,expectedVersion:payload.version})})
      const result=await response.json() as {error?:string}
      if(!response.ok)throw new Error(result.error==='VERSION_CONFLICT'?
        '其他管理员已修改备份配置，请刷新后重试':result.error||'保存失败')
      await refresh();setMessage('备份周期和范围已经保存')
    }catch(error){setMessage(error instanceof Error?error.message:'保存失败')}
    finally{setBusy(false)}
  }
  async function run(){
    if(busy)return
    setBusy(true);setMessage('正在生成可恢复的备份归档…')
    try{
      const response=await fetch('/api/admin/backups/run',{method:'POST'})
      const data=await response.json() as {status?:string;created?:number;error?:string}
      if(!response.ok||data.status==='busy')
        throw new Error(data.status==='busy'?'已有备份任务在运行':data.error||'备份失败')
      await refresh();setMessage('备份完成，已为 '+(data.created??0)+' 个世界观生成归档')
    }catch(error){setMessage(error instanceof Error?error.message:'备份失败')}
    finally{setBusy(false)}
  }
  if(!policy||!payload)return <p className="text-ui text-ink-muted">{message||'正在读取备份设置…'}</p>
  const nextRun=policy.lastRunAt
    ?new Date(Date.parse(policy.lastRunAt)+policy.intervalHours*3600000).toLocaleString('zh-CN')
    :'配置启用后在下一个定期检查周期执行'
  return <div className="mx-auto max-w-4xl space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-semibold">管理员 · 自动备份</h1>
        <p className="mt-1 text-caption text-ink-muted">每份归档包含完整世界观资料、图片及配置，可用于灾难恢复。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN_QUIET} onClick={()=>void refresh()} disabled={busy}>
          <RefreshCw size={14}/>刷新</button>
        <button type="button" className={BTN_QUIET} disabled={busy} onClick={()=>void run()}>
          <DatabaseBackup size={14}/>立即备份</button>
        <button type="button" className={BTN_PRIMARY} onClick={()=>void save()} disabled={busy}>
          <Save size={14}/>保存设置</button>
      </div>
    </div>
    {!payload.workerConfigured&&<p role="alert" className="text-ui text-error">
      定期任务密钥尚未配置。请在 VPS 的 deploy/.env 中填写 BACKUP_WORKER_TOKEN，
      更新容器后开启周期任务；仍可使用“立即备份”。
    </p>}
    <section className="rounded-panel border border-line bg-paper p-4 space-y-4">
      <label className="flex items-center gap-2 text-ui">
        <input type="checkbox" checked={policy.enabled}
          onChange={event=>setPolicy({...policy,enabled:event.target.checked})}/>启用自动备份
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-ui">备份周期
          <select aria-label="备份周期" className={FIELD_INPUT} value={policy.intervalHours}
            onChange={event=>setPolicy({...policy,intervalHours:Number(event.target.value)})}>
            {INTERVALS.map(o=><option value={o.hours} key={o.hours}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-ui">每个世界观保留份数
          <input aria-label="每个世界观保留份数" type="number" min={1} max={30}
            className={FIELD_INPUT} value={policy.keepPerWorkspace}
            onChange={event=>setPolicy({...policy,keepPerWorkspace:
              Math.min(30,Math.max(1,Number(event.target.value)||1))})}/>
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-ui">备份范围</legend>
        <label className="mr-5 inline-flex items-center gap-2 text-ui">
          <input type="radio" checked={policy.scope==='all'}
            onChange={()=>setPolicy({...policy,scope:'all'})}/>所有世界观
        </label>
        <label className="inline-flex items-center gap-2 text-ui">
          <input type="radio" checked={policy.scope==='selected'}
            onChange={()=>setPolicy({...policy,scope:'selected'})}/>指定世界观
        </label>
        {policy.scope==='selected'&&<div className="mt-3 max-h-48 space-y-2 overflow-y-auto rounded-item border border-line p-3">
          {payload.workspaces.map(workspace=><label key={workspace.id}
            className="flex items-center gap-2 text-ui">
            <input type="checkbox" checked={policy.workspaceIds.includes(workspace.id)}
              onChange={event=>setPolicy({...policy,workspaceIds:event.target.checked
                ?[...policy.workspaceIds,workspace.id]
                :policy.workspaceIds.filter(id=>id!==workspace.id)})}/>
            <span>{workspace.name}</span>
          </label>)}
        </div>}
      </fieldset>
      <p className="text-caption text-ink-muted">上次成功备份：{policy.lastRunAt?
        new Date(policy.lastRunAt).toLocaleString('zh-CN'):'暂无'} · 下次预计：{nextRun}</p>
    </section>
    {message&&<p role="status" className="text-ui text-ink-muted">{message}</p>}
    <section className="rounded-panel border border-line p-4">
      <h2 className="mb-3 text-ui font-semibold">已保存的备份归档</h2>
      <div className="divide-y divide-line">
        {payload.files.length===0?<p className="text-caption text-ink-muted">暂无归档</p>:
        payload.files.map(file=>{
          const world=payload.workspaces.find(w=>w.id===file.workspaceId)
          return <div key={file.workspaceId+'/'+file.filename}
            className="flex flex-wrap items-center justify-between gap-2 py-2 text-caption">
            <div className="min-w-0"><strong>{world?.name||file.workspaceId}</strong>
              <p className="text-ink-muted">{new Date(file.updatedAt).toLocaleString('zh-CN')} ·
                {' '}{(file.bytes/1024/1024).toFixed(2)} MB</p>
            </div>
            <a className={BTN_QUIET}
              href={'/api/admin/backups/files/'+file.workspaceId+'/'+file.filename}
              download={file.filename}><Download size={13}/>下载归档</a>
          </div>
        })}
      </div>
    </section>
  </div>
}

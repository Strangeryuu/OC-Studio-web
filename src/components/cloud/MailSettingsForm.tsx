'use client'
import { useEffect,useState,type FormEvent } from 'react'
type Config={mode:'local'|'smtp';from:string;host:string;port:number;secure:boolean;username:string;
  passwordSet:boolean}
const initial:Config={mode:'local',from:'',host:'',port:587,secure:false,username:'',passwordSet:false}
export function MailSettingsForm(){
 const [config,setConfig]=useState(initial),[password,setPassword]=useState('')
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[saved,setSaved]=useState(false)
 useEffect(()=>{void fetch('/api/admin/mail',{cache:'no-store'}).then(r=>r.json()).then(v=>{
   if(v.settings)setConfig(v.settings)
 }).catch(()=>setError('邮件配置读取失败'))},[])
 const patch=(change:Partial<Config>)=>setConfig(current=>({...current,...change}))
 async function submit(event:FormEvent<HTMLFormElement>){
   event.preventDefault();if(busy)return
   setBusy(true);setSaved(false);setError(null)
   try{
     const res=await fetch('/api/admin/mail',{method:'PUT',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({...config,password:password||undefined})})
     const result:{error?:string}=await res.json()
     if(!res.ok)throw Error(result.error??'保存失败')
     setPassword('');setSaved(true);patch({passwordSet:config.passwordSet||!!password})
   }catch(e){setError(e instanceof Error?e.message:'保存失败')}finally{setBusy(false)}
 }
 return <section className="max-w-2xl space-y-4">
   <a href="/admin" className="text-sm underline">返回管理员菜单</a>
   <h1 className="text-2xl font-semibold">找回密码邮件设置</h1>
   <p className="text-sm opacity-70">用户提交找回密码后，系统会发送一小时内有效的重置链接。SMTP 密码经加密后保存于服务端数据库。</p>
   <form onSubmit={submit} className="grid gap-3 rounded-panel border border-[var(--oc-line)] p-5 text-sm">
     <label>发送方式<select className="mt-1 block w-full rounded-control border border-[var(--oc-line)] p-2 bg-transparent"
       value={config.mode} onChange={e=>patch({mode:e.target.value as Config['mode']})}>
       <option value="local">本机 Sendmail</option><option value="smtp">SMTP 邮件服务器</option></select></label>
     <label>发件人邮箱<input type="email" required value={config.from}
       onChange={e=>patch({from:e.target.value})} className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2"/></label>
     {config.mode==='smtp'?<>
       <label>SMTP 主机<input required value={config.host} onChange={e=>patch({host:e.target.value})}
         className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2"/></label>
       <label>SMTP 端口<input required type="number" min={1} max={65535} value={config.port}
         onChange={e=>patch({port:Number(e.target.value)})}
         className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2"/></label>
       <label className="flex items-center gap-2"><input type="checkbox" checked={config.secure}
         onChange={e=>patch({secure:e.target.checked,port:e.target.checked?465:587})}/>直接使用 TLS（通常端口 465；其他端口要求 STARTTLS）</label>
       <label>SMTP 用户名<input value={config.username} onChange={e=>patch({username:e.target.value})}
         className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2"/></label>
       <label>SMTP 密码{config.passwordSet?'（已保存；留空则保留）':''}
         <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
           className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2" autoComplete="new-password"/></label>
     </>:<p className="text-xs opacity-70">需在 VPS / 容器内安装并配置本机 sendmail，默认执行路径为 /usr/sbin/sendmail。</p>}
     {error&&<p role="alert" className="text-danger">{error}</p>}
     {saved&&<p role="status">已保存。请用测试邮箱尝试找回密码，检查发信成功。</p>}
     <button disabled={busy} className="rounded-control bg-[var(--oc-ink)] p-3 text-[var(--oc-paper)]">
       {busy?'正在保存…':'保存邮件配置'}</button>
   </form>
 </section>
}

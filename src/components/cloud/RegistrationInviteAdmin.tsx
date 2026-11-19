'use client'
import { useEffect,useState,type FormEvent } from 'react'
type Code={id:string;label:string;used_count:number;max_uses:number;expires_at:string;revoked_at:string|null}
export function RegistrationInviteAdmin(){
  const [codes,setCodes]=useState<Code[]>([]),[code,setCode]=useState('')
  const [label,setLabel]=useState(''),[uses,setUses]=useState(1),[days,setDays]=useState(7)
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  async function load(){
    const res=await fetch('/api/admin/registration-codes',{cache:'no-store'})
    const data:{codes?:Code[]}=await res.json()
    if(res.ok)setCodes(data.codes??[])
  }
  useEffect(()=>{void load()},[])
  async function create(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return
    setBusy(true);setError(null);setCode('')
    try{
      const res=await fetch('/api/admin/registration-codes',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({label,maxUses:uses,expiresDays:days})})
      const result:{code?:string;error?:string}=await res.json()
      if(!res.ok||!result.code)throw Error(result.error??'创建失败')
      setCode(result.code);await load()
    }catch(e){setError(e instanceof Error?e.message:'创建失败')}finally{setBusy(false)}
  }
  async function revoke(id:string){
    if(!window.confirm('确认撤销此注册码？'))return
    const r=await fetch('/api/admin/registration-codes/'+id,{method:'DELETE'})
    if(!r.ok)setError('撤销失败')
    else await load()
  }
  return <section className="max-w-3xl space-y-5">
    <a href="/admin" className="text-sm underline">返回管理员菜单</a>
    <h1 className="text-2xl font-semibold">注册码管理</h1>
    <form onSubmit={create} className="grid gap-3 rounded-panel border border-[var(--oc-line)] p-4 text-sm sm:grid-cols-3">
      <label>备注<input className="mt-1 w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2" maxLength={100}
        value={label} onChange={e=>setLabel(e.target.value)}/></label>
      <label>最多注册人数<input type="number" min={1} max={100}
        className="mt-1 w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2" value={uses}
        onChange={e=>setUses(Number(e.target.value))}/></label>
      <label>有效期（天）<input type="number" min={1} max={90}
        className="mt-1 w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2" value={days}
        onChange={e=>setDays(Number(e.target.value))}/></label>
      <button disabled={busy} className="rounded-control bg-[var(--oc-ink)] p-2 text-[var(--oc-paper)]">创建注册码</button>
    </form>
    {code&&<p className="break-all rounded-panel border border-[var(--oc-line)] p-3 text-sm">
      新注册码（仅本次显示）：<code className="select-all">{code}</code></p>}
    {error&&<p role="alert" className="text-danger">{error}</p>}
    <ul className="space-y-2">{codes.map(item=><li key={item.id}
      className="flex flex-wrap justify-between gap-2 rounded-panel border border-[var(--oc-line)] p-3 text-sm">
      <div>{item.label||'未命名'} · {item.used_count}/{item.max_uses} 已使用
        <p className="text-xs opacity-60">到期：{new Date(item.expires_at).toLocaleString('zh-CN')}
        {item.revoked_at?' · 已撤销':''}</p></div>
      {!item.revoked_at&&<button className="underline" onClick={()=>void revoke(item.id)}>撤销</button>}
    </li>)}</ul>
  </section>
}

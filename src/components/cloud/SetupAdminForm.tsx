'use client'
import { useState,type FormEvent } from 'react'
export function SetupAdminForm(){
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState('')
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return
    setBusy(true);setError(null)
    try{
      const response=await fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name,email,password})})
      const data:{error?:string}=await response.json()
      if(!response.ok)throw Error(data.error==='ALREADY_INITIALIZED'?'此实例已经完成初始化':data.error??'初始化失败')
      window.location.replace('/login?initialized=1')
    }catch(e){setError(e instanceof Error?e.message:'初始化失败')}
    finally{setBusy(false)}
  }
  return <section className="w-full rounded-panel border border-[var(--oc-line)] p-7">
    <h1 className="text-xl font-semibold">初始化 OC Studio 管理员</h1>
    <p className="my-4 text-sm opacity-75">首次部署设置最高权限账号。创建成功后初始化入口自动关闭。</p>
    <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
      <label>用户名<input className="mt-1 block w-full rounded-control border border-[var(--oc-line)] p-2 bg-transparent"
        value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={100}/></label>
      <label>管理员邮箱<input type="email" className="mt-1 block w-full rounded-control border border-[var(--oc-line)] p-2 bg-transparent"
        value={email} onChange={e=>setEmail(e.target.value)} required/></label>
      <label>管理员密码（至少 12 位）<input type="password" autoComplete="new-password" minLength={12}
        className="mt-1 block w-full rounded-control border border-[var(--oc-line)] p-2 bg-transparent"
        value={password} onChange={e=>setPassword(e.target.value)} required/></label>
      {error&&<p role="alert" className="text-danger">{error}</p>}
      <button disabled={busy} className="rounded-control bg-[var(--oc-ink)] p-3 text-[var(--oc-paper)]">
        {busy?'初始化中…':'创建管理员并完成初始化'}</button>
    </form>
  </section>
}

'use client'
import { useState,type FormEvent } from 'react'
export function RegistrationForm(){
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState('')
  const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return
    setBusy(true);setError(null)
    try{
      const res=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name,email,password,inviteCode:code})})
      const result:{error?:string}=await res.json()
      if(!res.ok)throw Error(result.error==='INVITE_INVALID'?'邀请码已过期、已使用完或被撤销':
        result.error==='EMAIL_ALREADY_USED'?'邮箱已被注册':result.error??'注册失败')
      window.location.replace('/login?registered=1')
    }catch(e){setError(e instanceof Error?e.message:'注册失败')}finally{setBusy(false)}
  }
  return <section className="w-full max-w-sm rounded-panel border border-[var(--oc-line)] p-7">
    <h1 className="mb-2 text-xl font-semibold">使用邀请码注册</h1>
    <p className="mb-5 text-sm opacity-70">普通账号拥有自己的世界观，也可以加入邀请的协作项目。</p>
    <form className="grid gap-3 text-sm" onSubmit={submit}>
      <label>用户名<input required minLength={2} maxLength={100} value={name} onChange={e=>setName(e.target.value)}
        className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2"/></label>
      <label>邮箱<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}
        className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2"/></label>
      <label>密码（至少 12 位）<input type="password" required minLength={12} autoComplete="new-password"
        value={password} onChange={e=>setPassword(e.target.value)}
        className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2"/></label>
      <label>注册码<input required minLength={48} maxLength={48} value={code} onChange={e=>setCode(e.target.value)}
        className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2"/></label>
      {error&&<p role="alert" className="text-danger">{error}</p>}
      <button disabled={busy} className="rounded-control bg-[var(--oc-ink)] p-2 text-[var(--oc-paper)]">
        {busy?'注册中…':'创建账号'}</button>
    </form>
    <a href="/login" className="mt-4 block text-sm underline">返回登录</a>
  </section>
}

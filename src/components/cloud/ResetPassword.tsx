'use client'
import {useState,type FormEvent} from 'react'
import { authClient } from '@/lib/cloud/auth-client'
export function ResetPassword({token,error:linkError}:{token:string;error:string}){
 const [password,setPassword]=useState(''),[repeat,setRepeat]=useState('')
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[success,setSuccess]=useState(false)
 async function submit(event:FormEvent<HTMLFormElement>){
   event.preventDefault();if(busy)return
   if(password!==repeat){setError('两次密码不一致');return}
   setBusy(true);setError(null)
   try{
     const result=await authClient.resetPassword({token,newPassword:password})
     if(result.error)throw Error('重置链接可能已过期或已使用，请重新申请')
     setSuccess(true)
   }catch(e){setError(e instanceof Error?e.message:'密码重置失败')}
   finally{setBusy(false)}
 }
 return <section className="w-full max-w-sm rounded-panel border border-[var(--oc-line)] p-7">
   <h1 className="mb-3 text-xl font-semibold">设置新密码</h1>
   {!token||linkError?<p className="text-sm text-danger">链接失效或已过期，请重新申请。</p>:
     success?<p role="status" className="text-sm">密码已修改，请使用新密码登录。</p>:
     <form className="grid gap-3" onSubmit={submit}>
       <label className="text-sm">新密码<input type="password" minLength={12} autoComplete="new-password"
         required value={password} onChange={e=>setPassword(e.target.value)}
         className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2"/></label>
       <label className="text-sm">再次输入<input type="password" minLength={12} required value={repeat}
         onChange={e=>setRepeat(e.target.value)}
         className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2"/></label>
       {error&&<p role="alert" className="text-danger">{error}</p>}
       <button disabled={busy} className="rounded-control bg-[var(--oc-ink)] p-3 text-[var(--oc-paper)]">修改密码</button>
     </form>}
   <a href="/login" className="mt-4 block text-sm underline">返回登录</a>
 </section>
}

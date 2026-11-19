'use client'
import {useState,type FormEvent} from 'react'
import { authClient } from '@/lib/cloud/auth-client'
export function ForgotPassword(){
 const [email,setEmail]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 async function submit(event:FormEvent<HTMLFormElement>){
   event.preventDefault();if(busy)return
   setBusy(true)
   try{
     await authClient.requestPasswordReset({email:email.trim().toLowerCase(),redirectTo:'/reset-password'})
     setMessage('如该邮箱已注册且邮件发送服务可用，重置链接将发送到你的邮箱。')
   }catch{setMessage('如该邮箱已注册且邮件发送服务可用，重置链接将发送到你的邮箱。')}
   finally{setBusy(false)}
 }
 return <section className="w-full max-w-sm rounded-panel border border-[var(--oc-line)] p-7">
   <h1 className="text-xl font-semibold">找回密码</h1>
   <p className="my-3 text-sm opacity-70">输入注册邮箱，接收限时密码重置链接。</p>
   <form className="grid gap-3" onSubmit={submit}>
     <label className="text-sm">电子邮箱<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}
       className="mt-1 block w-full rounded-control border border-[var(--oc-line)] bg-transparent p-2"/></label>
     <button disabled={busy} className="rounded-control bg-[var(--oc-ink)] p-3 text-[var(--oc-paper)]">发送重置邮件</button>
   </form>
   {message&&<p role="status" className="mt-3 text-sm">{message}</p>}
   <a href="/login" className="mt-4 block text-sm underline">返回登录</a>
 </section>
}

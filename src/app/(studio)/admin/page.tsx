import { redirect,notFound } from 'next/navigation'
import Link from 'next/link'
import { siteAdminUser } from '@/lib/cloud/server/site-admin'
export const dynamic='force-dynamic'
const options=[
  {url:'/admin/users',name:'用户管理',description:'创建账号、调整账号角色及禁用用户'},
  {url:'/admin/invites',name:'注册码管理',description:'生成、管理及撤销用户注册码'},
  {url:'/admin/mail',name:'找回密码邮件',description:'选择本机发送或 SMTP 并配置服务器'},
  {url:'/',name:'全部世界观',description:'管理员可以查看和编辑全站资料库'},
]
export default async function Page(){
  const actor=await siteAdminUser()
  if(!actor)notFound()
  return <section className="mx-auto max-w-4xl">
    <h1 className="mb-3 text-2xl font-semibold">管理员菜单</h1>
    <p className="mb-5 text-sm opacity-70">全站管理员 · {actor.email}。系统设置及用户权限集中管理。</p>
    <div className="grid gap-4 sm:grid-cols-2">{options.map(opt=>
      <Link href={opt.url} key={opt.url} className="rounded-panel border border-[var(--oc-line)] p-5 hover:opacity-80">
        <h2 className="font-semibold">{opt.name}</h2><p className="mt-2 text-sm opacity-70">{opt.description}</p>
      </Link>)}</div>
  </section>
}

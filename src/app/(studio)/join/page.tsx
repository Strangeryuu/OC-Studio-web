import { InviteAcceptForm } from '@/components/cloud/InviteAcceptForm'
import Link from 'next/link'

export default function JoinPage() {
  return <div className="flex flex-col gap-5">
    <Link href="/" className="text-sm opacity-70">返回工作台</Link>
    <h1 className="text-2xl font-semibold">接受世界观邀请</h1>
    <p className="text-sm opacity-70">请使用收到邀请时指定的账号登录，并粘贴邀请代码。</p>
    <InviteAcceptForm />
  </div>
}

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/cloud/server/auth'
import { SignOutButton } from '@/components/cloud/SignOutButton'
import { THEME_BOOT_SCRIPT } from '@/lib/theme/boot'
import '../globals.css'

export const metadata: Metadata = {
  title: 'OC Studio Cloud',
  description: '私人世界观与邀请协作',
}

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session || session.user.banned) redirect('/login')
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /></head>
      <body className="min-h-screen bg-[var(--oc-paper)] text-[var(--oc-ink)]">
        <header className="border-b border-[var(--oc-line)] px-5 py-3">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <Link href="/" className="font-semibold">OC Studio Cloud</Link>
            <nav className="flex items-center gap-4 text-sm">
              <a href="/join" className="opacity-80 hover:opacity-100">接受邀请</a>
              {session.user.role?.split(',').includes('admin') &&
                <a href="/admin/users" className="opacity-80 hover:opacity-100">用户管理</a>}
              <SignOutButton />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
      </body>
    </html>
  )
}

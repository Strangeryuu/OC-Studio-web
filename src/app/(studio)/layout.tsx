import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/cloud/server/auth'
import { OverlayRoot } from '@/components/layout/OverlayRoot'
import { SignOutButton } from '@/components/cloud/SignOutButton'
import { THEME_BOOT_SCRIPT } from '@/lib/theme/boot'
import { setupNeeded } from '@/lib/cloud/server/site-admin'
import { isSiteAdmin } from '@/lib/cloud/site-policy'
import '../globals.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'OC Studio Cloud',
  description: '私人世界观与邀请协作',
}

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders=await headers()
  if(await setupNeeded())redirect('/setup')
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session || session.user.banned) redirect('/login')
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /></head>
      <body className="min-h-screen bg-[var(--oc-paper)] text-[var(--oc-ink)]">
        <header className="border-b border-[var(--oc-line)] px-5 py-3">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <Link href="/" className="font-semibold">OC Studio Cloud</Link>
            <nav className="flex items-center gap-4 text-sm">
              <a href="/join" className="opacity-80 hover:opacity-100">接受邀请</a>
              {isSiteAdmin(session.user.role) &&
                <a href="/admin" className="opacity-80 hover:opacity-100">管理员菜单</a>}
              <SignOutButton />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-5">{children}</main>
        <OverlayRoot />
      </body>
    </html>
  )
}

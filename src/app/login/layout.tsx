import type { Metadata } from 'next'
import { THEME_BOOT_SCRIPT } from '@/lib/theme/boot'
import '../globals.css'

export const metadata: Metadata = { title: '登录 · OC Studio' }

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /></head>
      <body className="min-h-screen bg-[var(--oc-paper)] text-[var(--oc-ink)]">{children}</body>
    </html>
  )
}

import type { Metadata } from 'next'
import '../globals.css'
import { THEME_BOOT_SCRIPT } from '@/lib/theme/boot'

export const metadata: Metadata = {
  title: '世界观公开阅读 · OC Studio',
  description: '通过分享链接只读浏览 OC Studio 世界观',
  robots: { index: false, follow: false, nocache: true },
}

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
    <head>
      <meta name="referrer" content="no-referrer" />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
    </head>
    <body className="min-h-screen bg-[var(--oc-paper)] text-[var(--oc-ink)]">{children}</body>
  </html>
}

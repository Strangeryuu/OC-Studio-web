import '../globals.css'
import type { Metadata } from 'next'
import { THEME_BOOT_SCRIPT } from '@/lib/theme/boot'
export const metadata:Metadata={title:'管理员初始化 · OC Studio'}
export default function Layout({children}:{children:React.ReactNode}){
  return <html lang="zh-CN" className="h-full" suppressHydrationWarning><head>
    <script dangerouslySetInnerHTML={{__html:THEME_BOOT_SCRIPT}} /></head>
    <body className="min-h-screen bg-[var(--oc-paper)] text-[var(--oc-ink)]">{children}</body></html>
}

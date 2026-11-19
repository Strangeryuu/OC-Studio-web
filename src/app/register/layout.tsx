import '../globals.css'
import { THEME_BOOT_SCRIPT } from '@/lib/theme/boot'
export default function Layout({children}:{children:React.ReactNode}){
 return <html lang="zh-CN" suppressHydrationWarning><head>
   <script dangerouslySetInnerHTML={{__html:THEME_BOOT_SCRIPT}}/></head>
   <body className="min-h-screen bg-[var(--oc-paper)] text-[var(--oc-ink)]">{children}</body></html>
}

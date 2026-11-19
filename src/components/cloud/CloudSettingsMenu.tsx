'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Settings2, Shield, SunMoon } from 'lucide-react'
import { useSettings } from '@/lib/settings'
import { THEME_PRESETS } from '@/lib/theme/presets'

/** Persistent click-open menu: choosing a theme does not dismiss the menu. */
export function CloudSettingsMenu({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { settings, updateSetting } = useSettings()

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return <div ref={menuRef} className="relative z-40">
    <button type="button" title="设置" aria-label="设置" aria-expanded={open}
      aria-haspopup="dialog" onClick={() => setOpen(value => !value)}
      className={`flex h-9 items-center gap-1 rounded-item border px-2.5 text-ui transition-colors hover:bg-[var(--oc-hover)]
        ${open ? 'border-line-hover bg-paper-card text-ink' : 'border-line text-ink-muted'}`}>
      <Settings2 size={17} strokeWidth={1.9} aria-hidden />
      <span className="hidden sm:inline">设置</span>
      <ChevronDown size={13} aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div role="dialog" aria-label="设置菜单"
      className="absolute right-0 top-[calc(100%+0.6rem)] z-50 w-[min(21rem,calc(100vw-2rem))] max-h-[min(75vh,36rem)] overflow-y-auto rounded-panel border border-line bg-paper p-4 text-ink shadow-xl">
      <div className="flex items-center gap-2 border-b border-line pb-3">
        <SunMoon size={17} className="text-ink-muted" aria-hidden />
        <h2 className="text-ui font-semibold">外观与设置</h2>
      </div>
      <fieldset className="mt-4">
        <legend className="mb-2 text-caption font-medium text-ink-muted">显示模式</legend>
        <div className="grid grid-cols-3 gap-1 rounded-item border border-line bg-paper-alt p-1">
          {([['light','浅色'], ['dark','深色'], ['auto','跟随系统']] as const).map(([mode, name]) =>
            <button type="button" key={mode} aria-pressed={settings.theme === mode}
              onClick={() => updateSetting('theme', mode)}
              className={`min-h-9 rounded-item px-1.5 text-caption transition-colors
                ${settings.theme === mode ? 'border border-line bg-paper-card font-medium text-ink shadow-sm' : 'text-ink-muted hover:bg-[var(--oc-hover)] hover:text-ink'}`}>
              {name}
            </button>)}
        </div>
      </fieldset>
      <fieldset className="mt-4">
        <legend className="mb-2 text-caption font-medium text-ink-muted">主题配色</legend>
        <div className="grid grid-cols-2 gap-2">
          {THEME_PRESETS.map(preset => <button type="button" key={preset.id}
            aria-pressed={settings.themePreset === preset.id}
            onClick={() => updateSetting('themePreset', preset.id)}
            className={`flex min-h-11 items-center gap-2 rounded-item border p-2 text-left text-caption transition-colors hover:bg-[var(--oc-hover)]
              ${settings.themePreset === preset.id ? 'border-line-hover bg-paper-card text-ink' : 'border-line text-ink-muted'}`}>
            <span className="h-5 w-5 shrink-0 rounded-full border border-line"
              style={{ background: preset.swatch }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{preset.name}</span>
            {settings.themePreset === preset.id && <Check size={14} strokeWidth={2} aria-hidden />}
          </button>)}
        </div>
      </fieldset>
      {isAdmin && <div className="mt-4 border-t border-line pt-3">
        <Link href="/admin" onClick={() => setOpen(false)}
          className="flex h-10 items-center gap-2 rounded-item px-2 text-ui text-ink-muted hover:bg-[var(--oc-hover)] hover:text-ink">
          <Shield size={16} aria-hidden />管理员菜单
        </Link>
      </div>}
      <p className="mt-3 text-micro text-ink-faint">外观偏好保存在当前浏览器，切换后立即生效。</p>
    </div>}
  </div>
}

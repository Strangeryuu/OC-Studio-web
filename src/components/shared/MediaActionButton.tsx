'use client'

import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { MediaContextMenu, type MediaMenuItem } from './MediaContextMenu'

/** A single touch/keyboard accessible trigger for image upload, replace and delete actions. */
export function MediaActionButton({ items, label = '图片操作', disabled = false }: {
  items: MediaMenuItem[]; label?: string; disabled?: boolean
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  return <>
    <button type="button" aria-label={label} title={label}
      aria-haspopup="menu" aria-expanded={at !== null} disabled={disabled || items.length === 0}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-line bg-paper text-ink-muted transition-colors hover:bg-[var(--oc-hover)] hover:text-ink disabled:opacity-40"
      onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        setAt(current => current ? null : { x: rect.right, y: rect.bottom })
      }}>
      <MoreHorizontal size={18} strokeWidth={2} aria-hidden="true" />
    </button>
    {at && <MediaContextMenu at={at} items={items} onClose={() => setAt(null)} />}
  </>
}

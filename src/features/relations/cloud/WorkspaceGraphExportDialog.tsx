'use client'

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft } from 'lucide-react'
import { GraphPanel, type WorkspaceGraphExportSource } from '@/components/shared/export/GraphPanel'
import { ICON_BTN, PAGE_TITLE } from '@/lib/ui-tokens'

/**
 * Cloud counterpart of the original ExportCenter's graph tab.
 * Reuses GraphPanel's source selection, preview and all nine export options,
 * with the caller's versioned workspace entities instead of desktop Dexie.
 */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function WorkspaceGraphExportDialog({ source, onClose }: {
  source: WorkspaceGraphExportSource
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [onClose])

  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const root = dialogRef.current
    if (!root) return
    const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter(item => item.offsetParent !== null)
    if (!items.length) return
    if (!event.shiftKey && document.activeElement === items[items.length - 1]) {
      event.preventDefault()
      items[0].focus()
    } else if (event.shiftKey && document.activeElement === items[0]) {
      event.preventDefault()
      items[items.length - 1].focus()
    }
  }

  return createPortal(
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="导出中心 · 关系图"
      onKeyDown={trapTab}
      className="pointer-events-auto fixed inset-0 z-50 flex flex-col bg-paper pt-[var(--oc-titlebar-h)]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
        <button ref={closeRef} type="button" onClick={onClose} className={ICON_BTN} aria-label="返回关系图">
          <ArrowLeft size={16} strokeWidth={2} />
        </button>
        <h2 className={PAGE_TITLE}>导出中心 · 关系图</h2>
      </header>
      <div className="flex min-h-0 flex-1">
        <GraphPanel workspace={source} />
      </div>
    </div>,
    document.body,
  )
}

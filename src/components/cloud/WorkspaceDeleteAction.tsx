'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { BTN_DANGER, BTN_QUIET } from '@/lib/ui-tokens'

/** Reusable destructive action for all cloud workspace entity and custom-category lists. */
export function WorkspaceDeleteAction({ label, description, disabled = false, compact = false, onConfirm }: {
  label: string
  description: string
  disabled?: boolean
  compact?: boolean
  onConfirm: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (deleting || disabled) return
    setDeleting(true)
    setError(null)
    try {
      await onConfirm()
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败，请重试')
    } finally {
      setDeleting(false)
    }
  }

  return <AlertDialog open={open} onOpenChange={value => {
    if (!deleting) { setOpen(value); setError(null) }
  }}>
    <AlertDialogTrigger asChild>
      <button type="button" disabled={disabled || deleting}
        className={BTN_QUIET} aria-label={'删除' + label} title={'删除' + label}
        onClick={event => event.stopPropagation()}>
        <Trash2 size={14} aria-hidden="true" />{!compact && '删除'}
      </button>
    </AlertDialogTrigger>
    <AlertDialogContent onClick={event => event.stopPropagation()}>
      <AlertDialogHeader>
        <AlertDialogTitle>确认删除{label}？</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      {error && <p role="alert" className="text-ui text-error">{error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
        <button type="button" className={BTN_DANGER} disabled={deleting}
          onClick={() => void confirm()}>{deleting ? '正在删除…' : '确认删除'}</button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

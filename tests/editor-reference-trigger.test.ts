import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { insertReferenceTrigger } from '@/components/editor/insert-reference-trigger'

describe('toolbar reference insertion', () => {
  it.each(['@', '[['] as const)('preserves selected text before %s and starts completion at its end', trigger => {
    const run = vi.fn().mockReturnValue(true)
    const insertContentAt = vi.fn().mockReturnValue({ run })
    const focus = vi.fn().mockReturnValue({ insertContentAt })
    const editor = { state: { selection: { from: 2, to: 9 } }, chain: () => ({ focus }) } as unknown as Editor
    expect(insertReferenceTrigger(editor, trigger)).toBe(true)
    expect(insertContentAt).toHaveBeenCalledWith(9, ' ' + trigger)
    expect(run).toHaveBeenCalledOnce()
  })
})

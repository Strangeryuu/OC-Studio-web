import type { Editor } from '@tiptap/core'

/** Toolbar reference shortcuts append after a selected passage without replacing it. */
export function insertReferenceTrigger(editor: Editor, trigger: '@' | '[['): boolean {
  const { to } = editor.state.selection
  return editor.chain().focus().insertContentAt(to, ' ' + trigger).run()
}

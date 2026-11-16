'use client'

import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { JSONContent } from '@tiptap/core'

export function CloudSnapshotBody({ content }: { content: JSONContent }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content,
    editable: false,
    immediatelyRender: false,
    editorProps: { attributes: { class: 'min-h-20 px-3 py-2 text-sm leading-7' } },
  })
  return <div className="rounded-md border border-[var(--oc-line)]"><EditorContent editor={editor}/></div>
}

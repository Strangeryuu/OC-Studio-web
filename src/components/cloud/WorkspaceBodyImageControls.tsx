'use client'

import { useState } from 'react'
import type { Editor } from '@tiptap/core'
import { collectBodyImageRefs } from '@/lib/image-refs'
import { rewriteMediaReferences } from '@/lib/cloud/media-rewrite'
import { resolveImageUrl } from '@/lib/image-service'
import { BTN_QUIET } from '@/lib/ui-tokens'

/** Visible actions for previously uploaded pictures embedded in a TipTap document.
 * A local edit updates this editor's document. Global deletion is in the album.
 */
export function WorkspaceBodyImageControls({ editor, document, editable, upload }: {
  editor: Editor | null
  document: unknown
  editable: boolean
  upload: (file: File) => Promise<string | null>
}) {
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pictures = collectBodyImageRefs(document)

  function change(oldUrl: string, newUrl: string | null) {
    if (!editable || !editor || editor.isDestroyed) return
    const current = editor.getJSON()
    const updated = rewriteMediaReferences(current, oldUrl, newUrl)
    if (updated.references > 0) editor.commands.setContent(updated.value)
  }

  async function replace(oldUrl: string, file?: File) {
    if (!editable || !editor || !file) return
    setWorking(oldUrl)
    setError(null)
    try {
      const saved = await upload(file)
      if (!saved) throw new Error('图片上传未完成，请重试')
      change(oldUrl, saved)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '替换失败') }
    finally { setWorking(null) }
  }

  if (!pictures.length) return null
  return <div className="mt-2 space-y-2 rounded-item border border-line p-2">
    <p className="text-caption text-ink-muted">正文已上传图片（{pictures.length} 张）</p>
    <div className="flex flex-wrap gap-3">
      {pictures.map((url, index) => <div key={url + ':' + index}
        className="flex w-28 flex-col gap-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={resolveImageUrl(url)} alt={'正文图片' + (index + 1)}
          className="h-20 w-28 rounded-item object-cover" />
        {editable && <div className="flex flex-wrap gap-1">
          <label className={BTN_QUIET + ' cursor-pointer'}>
            替换
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif"
              aria-label={'替换正文第' + (index + 1) + '张图片'}
              className="sr-only" disabled={working !== null}
              onChange={event => { const file = event.target.files?.[0];event.target.value = '';void replace(url, file) }} />
          </label>
          <button type="button" className={BTN_QUIET}
            disabled={working !== null}
            onClick={() => {
              if (window.confirm('确认从本词条正文移除图片？同一图片在其他词条的引用将保留。'))
                change(url, null)
            }}>删除</button>
        </div>}
      </div>)}
    </div>
    {working && <p className="text-caption text-ink-muted">正在替换图片…</p>}
    {error && <p role="alert" className="text-caption text-error">{error}</p>}
  </div>
}

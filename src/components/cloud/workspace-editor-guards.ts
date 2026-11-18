'use client'

import { useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import { cloudMediaUrlId } from '@/lib/cloud/character-media'
import { registerPendingSave } from '@/lib/pending-saves'

export function useWorkspaceImageUpload(
  workspaceId: string,
  canEdit: boolean,
  onBusy: (busy: boolean) => void,
  onError: (error: string | null) => void,
) {
  const uploading = useRef(false)
  useEffect(() => registerPendingSave(() => {
    if (uploading.current) throw new Error('图片正在上传，请稍后重试')
  }), [])

  return async (blob: Blob, filename?: string, onUploaded?: (url: string) => void): Promise<string | null> => {
    if (!canEdit || uploading.current) return null
    uploading.current = true
    onBusy(true)
    onError(null)
    try {
      const data = new FormData()
      if (filename) data.append('file', blob, filename)
      else data.append('file', blob)
      const response = await fetch(`/api/workspaces/${workspaceId}/media`, { method: 'POST', body: data })
      if (!response.ok) throw new Error('图片上传失败，请检查文件格式和大小')
      const result: { asset?: { url?: unknown } } = await response.json()
      const url = result.asset?.url
      if (typeof url !== 'string' || cloudMediaUrlId(url) === null) throw new Error('图片上传结果无效')
      onUploaded?.(url)
      return url
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : '图片上传失败')
      return null
    } finally {
      uploading.current = false
      onBusy(false)
    }
  }
}

export function useWorkspaceDraftGuard(active: boolean, label: string) {
  useEffect(() => {
    if (!active) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const guardLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || !(event.target instanceof Element)) return
      const anchor = event.target.closest('a[href]')
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      if (anchor.href === window.location.href || anchor.href.startsWith(`${window.location.href.split('#')[0]}#`)) return
      if (!window.confirm(`${label}仍有未保存的修改，离开此页面会丢失当前草稿。确定离开吗？`)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', guardLink, true)
    return () => {
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('click', guardLink, true)
    }
  }, [active, label])
}

export function insertWorkspaceBodyImage(editor: Editor, url: string) {
  if (editor.isDestroyed) throw new Error('编辑器已关闭，请重新添加图片')
  if (!editor.chain().insertContent({ type: 'imageBlock', attrs: { src: url, width: null } }).run()) {
    throw new Error('图片未能插入正文，请重试')
  }
}

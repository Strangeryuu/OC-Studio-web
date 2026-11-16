'use client'

import { useState, type ChangeEvent } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react'

export type CloudMediaMode = 'cover' | 'avatar' | 'portrait' | 'gallery'

const LIMITS: Record<CloudMediaMode, number> = {
  cover: 1, avatar: 1, portrait: 24, gallery: 48,
}
const ASPECT: Record<CloudMediaMode, string> = {
  cover: 'aspect-[16/7]', avatar: 'aspect-square',
  portrait: 'aspect-[9/16]', gallery: 'aspect-[4/3]',
}

export function CloudMediaPanel({
  title, mode, imageIds, editable, uploading, onUpload, onChange,
}: {
  title: string
  mode: CloudMediaMode
  imageIds: string[]
  editable: boolean
  uploading: boolean
  onUpload: (file: File) => Promise<string | null>
  onChange: (ids: string[]) => void
}) {
  const [localError, setLocalError] = useState<string | null>(null)
  const max = LIMITS[mode]
  const isSingle = max === 1
  const atLimit = imageIds.length >= max

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (!selected || !editable || uploading) return
    setLocalError(null)
    if (!isSingle && atLimit) {
      setLocalError('图片数量已达到上限')
      return
    }
    try {
      const mediaId = await onUpload(selected)
      if (mediaId) onChange(isSingle ? [mediaId] : [...imageIds, mediaId])
    } catch {
      setLocalError('上传失败，请重试')
    }
  }

  function move(index: number, shift: number) {
    const next = [...imageIds]
    const other = index + shift
    if (other < 0 || other >= next.length) return
    ;[next[index], next[other]] = [next[other], next[index]]
    onChange(next)
  }

  return <section className="rounded-lg border border-[var(--oc-line)] p-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <span className="text-xs opacity-60">{imageIds.length} / {max}</span>
    </div>
    <div className={mode === 'cover' ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'}>
      {imageIds.map((id, index) => <div key={id} className="min-w-0 overflow-hidden rounded-md border border-[var(--oc-line)]">
        <a href={'/api/media/' + encodeURIComponent(id)} target="_blank" rel="noopener noreferrer"
          className={'block overflow-hidden bg-black/5 ' + ASPECT[mode]}
          title={'查看原图 ' + (index + 1)}>
          <img src={'/api/media/' + encodeURIComponent(id)} alt={title + '第' + (index + 1) + '张'}
            className="h-full w-full object-contain" loading="lazy" />
        </a>
        {editable && <div className="flex items-center justify-end gap-2 p-2">
          {!isSingle && <>
            <button type="button" disabled={uploading || index === 0}
              aria-label={'上移第' + (index + 1) + '张'}
              onClick={() => move(index, -1)}><ArrowUp size={15}/></button>
            <button type="button" disabled={uploading || index === imageIds.length - 1}
              aria-label={'下移第' + (index + 1) + '张'}
              onClick={() => move(index, 1)}><ArrowDown size={15}/></button>
          </>}
          <button type="button" disabled={uploading} aria-label={'移除第' + (index + 1) + '张'}
            onClick={() => onChange(imageIds.filter((_, i) => i !== index))}>
            <Trash2 size={15}/>
          </button>
        </div>}
      </div>)}
      {imageIds.length === 0 && <div className={'flex items-center justify-center rounded-md border border-dashed border-[var(--oc-line)] ' + ASPECT[mode]}>
        <ImagePlus size={35} className="opacity-35"/>
      </div>}
    </div>
    {editable && <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-md border border-[var(--oc-line)] px-3 py-2 text-sm">
      <ImagePlus size={15} />
      {uploading ? '上传中…' : isSingle && imageIds.length ? '更换图片' : '上传图片'}
      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only" disabled={uploading || (!isSingle && atLimit)}
        onChange={event => void selectFile(event)} />
    </label>}
    {localError && <p className="mt-2 text-sm" role="alert">{localError}</p>}
    <p className="mt-2 text-xs opacity-60">
      JPEG、PNG、WebP 或 GIF；单张不超过 8 MB。移除只取消当前引用，旧版本保留图片记录。
    </p>
  </section>
}

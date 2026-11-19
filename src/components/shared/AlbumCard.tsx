'use client'

import { useLongPress } from '@/lib/useLongPress'
import type { AlbumEntry } from './useAlbumData'
import { useState } from 'react'
import { Replace, Trash2 } from 'lucide-react'
import { getDefaultImage } from '@/lib/image-service'
import { getEntryImageUrl } from './album-utils'
import { MediaContextMenu, type MediaMenuItem } from './MediaContextMenu'
import { useMediaDownload } from '@/lib/use-media-download'

interface AlbumCardProps {
  entry: AlbumEntry
  isMobile: boolean
  onNavigate?: (id: number, type: string) => void
  onLongPress?: () => void
  onViewImage: () => void
  onReplace?: () => void
  onDelete?: () => void
}

/**
 * 相册网格里的一张。
 *
 * 口径：**单击看大图，桌面右键出菜单，移动端长按出动作表**。
 * 两边的动作顺序一致（查看 → 保存到… → 跳转），菜单项由这里给，动作表在 `GlobalAlbum`。
 */
export function AlbumCard({
  entry,
  isMobile,
  onNavigate,
  onLongPress,
  onViewImage,
  onReplace,
  onDelete,
}: AlbumCardProps) {
  const longPress = useLongPress({
    onLongPress: onLongPress ?? (() => {}),
    enabled: isMobile,
  })

  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  // 「保存到…」的唯一口：`saving` 防连点，失败自己 toast
  const { save, saving } = useMediaDownload()

  const menuItems: MediaMenuItem[] = isMobile
    ? []
    : [
        { label: '查看大图', onSelect: onViewImage },
        {
          label: saving ? '保存中…' : '保存到…',
          onSelect: () => {
            void save(entry.url, entry.sourceName)
          },
        },
        ...(onNavigate
          ? [{ label: '跳转', onSelect: () => onNavigate(entry.sourceId, entry.sourceType) }]
          : []),
        ...(onReplace ? [{ label: '替换整库图片', onSelect: onReplace }] : []),
        ...(onDelete ? [{ label: '删除整库图片', danger: true, onSelect: onDelete }] : []),
      ]

  return (
    <div
      className="relative"
      onContextMenu={
        menuItems.length > 0
          ? (event) => {
              event.preventDefault()
              setMenuAt({ x: event.clientX, y: event.clientY })
            }
          : undefined
      }
      {...longPress}
    >
      <div className="touch-feedback overflow-hidden rounded-item">
        <img
          src={getEntryImageUrl(entry)}
          alt={entry.sourceName}
          className="aspect-square w-full object-cover transition-opacity hover:opacity-90"
          onClick={onViewImage}
          onError={(event) => {
            const img = event.currentTarget
            // 源图丢了就回落到占位图：**不要把 alt 文字露出来**（兜底图也失败时才留白）
            if (img.dataset.fallback === '1') return
            img.dataset.fallback = '1'
            img.alt = ''
            img.src = getDefaultImage('avatar')
          }}
        />
      </div>
      <div className="mt-1 truncate text-caption leading-4 text-ink-faint">{entry.sourceName}</div>
      {(onReplace || onDelete) && <div className="mt-1 flex flex-wrap items-center gap-1">
        {onReplace && <button type="button" onClick={onReplace}
          aria-label={'替换图片 ' + entry.sourceName}
          className="flex items-center gap-1 rounded-item px-1.5 py-1 text-caption text-ink-muted hover:bg-paper-alt">
          <Replace size={13}/>替换</button>}
        {onDelete && <button type="button" onClick={onDelete}
          aria-label={'删除图片 ' + entry.sourceName}
          className="flex items-center gap-1 rounded-item px-1.5 py-1 text-caption text-error hover:bg-paper-alt">
          <Trash2 size={13}/>删除</button>}
      </div>}

      {menuAt ? (
        <MediaContextMenu at={menuAt} items={menuItems} onClose={() => setMenuAt(null)} />
      ) : null}
    </div>
  )
}

'use client'

import { useState, useCallback } from 'react'
import { PointMenu, type PointMenuItem } from './menu/PointMenu'
import type { ContextMenuProps, ContextMenuItem } from './context-menu/context-menu-types'

export type { ContextMenuItem, ContextMenuProps }

/** 调用点的 `ContextMenuItem[]` → `PointMenu` 的 items（`onClick` → `onSelect`、`children` → `submenu`） */
function toPointItems(items: ContextMenuItem[]): PointMenuItem[] {
  return items.map((item) =>
    item.separator
      ? { separator: true }
      : {
          label: item.label,
          shortcut: item.shortcut,
          danger: item.danger,
          disabled: item.disabled,
          onSelect: item.onClick,
          submenu: item.children && item.children.length > 0 ? toPointItems(item.children) : undefined,
        },
  )
}

/**
 * 右键菜单：长按/右键弹出，位置自动贴边；带子菜单；仅明确关闭操作才收起。
 *
 * 布局 / 键盘 / 子菜单 / 点外关闭都归 `PointMenu`（Base UI Menu + 虚拟锚点）——
 * 子菜单现在能键盘进（→ / ← / Esc 逐层关 / Enter 确认）。
 * 保留编辑器右键入口；菜单可停留供用户浏览多级选项。
 * 退出统一交给 PointMenu（选择、Esc、外部按下），文本选区变化不会提前卸载。
 */
export function ContextMenu({ children, items }: ContextMenuProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  /** 淡出由 PointMenu 负责，它播完才回调这里 */
  const close = useCallback(() => setOpen(false), [])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // 坐标在「打开」的同一次更新里量好，不会先在左上角闪一帧
    setPosition({ x: e.clientX, y: e.clientY })
    setOpen(true)
  }, [])

  return (
    <div onContextMenu={handleContextMenu}>
      {children}

      {open ? (
        <PointMenu at={position} items={toPointItems(items)} onClose={close} minWidth={160} ariaLabel="右键菜单" />
      ) : null}
    </div>
  )
}

import { computeReorder, type TreeOrderUpdate } from '@/lib/tree-order'
import type { WorldEntry } from '@/types'
import { NOVEL_CATEGORY } from '@/lib/entry-kinds'

/** Original novel drag semantics, constrained to one book and acyclic parentage. */
export function planCloudNovelReorder(
  entries: WorldEntry[], bookId: number, draggedId: number, overId: number,
): TreeOrderUpdate[] | null {
  if (draggedId === overId || !Number.isSafeInteger(bookId) || bookId <= 0) return []
  const byId = new Map(entries.filter(row => row.category === NOVEL_CATEGORY).map(row => [row.id, row]))
  const root = byId.get(bookId)
  const dragged = byId.get(draggedId)
  const over = byId.get(overId)
  if (!root || root.parentId != null || !dragged || !over ||
      draggedId === bookId || overId === bookId) return null

  const inBook = (id: number): boolean => {
    const visited = new Set<number>()
    let current: WorldEntry | undefined = byId.get(id)
    while (current && !visited.has(current.id)) {
      if (current.id === bookId) return true
      visited.add(current.id)
      current = current.parentId == null ? undefined : byId.get(current.parentId)
    }
    return false
  }
  if (!inBook(draggedId) || !inBook(overId)) return null
  const newParent = over.parentId
  if (newParent == null || newParent === draggedId || !inBook(newParent)) return null
  // A chapter may not be moved under its own descendant.
  const descendants = new Set([draggedId])
  const queue = [draggedId]
  for (const id of queue) {
    for (const node of byId.values()) {
      if (node.parentId === id && !descendants.has(node.id)) {
        descendants.add(node.id)
        queue.push(node.id)
      }
    }
  }
  if (descendants.has(newParent)) return null
  const bookEntries = [...byId.values()].filter(row => inBook(row.id))
  return computeReorder(bookEntries, draggedId, newParent, overId)
}

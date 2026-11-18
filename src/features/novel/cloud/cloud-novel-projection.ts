import { NOVEL_CATEGORY } from '@/lib/entry-kinds'
import type { WorldEntry } from '@/types'
import { flattenNovel, countNovelWords } from '@/features/novel/export'
import { buildEntryTree, type WorldTreeNode } from '@/lib/world-tree'

export interface CloudBook {
  id: number
  title: string
  cover: string | undefined
  author: string
  chapters: number
  words: number
  order: number
}

/** Reuses the original novel model (worldEntry with category 小说 and parentId tree). */
export function novelSubtree(entries: readonly WorldEntry[], rootId: number): WorldEntry[] {
  const byId = new Map(entries.filter(row => row.category === NOVEL_CATEGORY).map(row => [row.id, row]))
  const root = byId.get(rootId)
  if (!root) return []
  const result: WorldEntry[] = []
  const seen = new Set<number>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const entry = byId.get(id)
    if (!entry) continue
    result.push(entry)
    for (const item of byId.values()) if (item.parentId === id && !seen.has(item.id)) stack.push(item.id)
  }
  return result
}

export function cloudNovelBooks(notes: readonly WorldEntry[]): CloudBook[] {
  const rows = notes.filter(row => row.category === NOVEL_CATEGORY && row.parentId == null)
  return rows.map(row => {
    const chapters = novelSubtree(notes, row.id).filter(entry => entry.id !== row.id)
    return {
      id: row.id, title: row.title, cover: row.novelCover,
      author: row.novelAuthor ?? '', order: row.order ?? 0,
      chapters: chapters.length, words: countNovelWords(flattenNovel(chapters)),
    }
  }).sort((a,b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-Hans'))
}

export function novelChapterTree(notes: readonly WorldEntry[], rootId: number) {
  const items = novelSubtree(notes, rootId).filter(row => row.id !== rootId)
  // Original builder places children of missing book root at chapter-tree root.
  return buildEntryTree(items)
}

export function safeNovelFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\.+$/, '').trim().slice(0, 120) || '小说'
}

/** The original novel tree preserves ancestors when a nested chapter matches search. */
export function filterCloudNovelTree(nodes: WorldTreeNode[], query: string): WorldTreeNode[] {
  const keyword = query.trim().toLocaleLowerCase()
  if (!keyword) return nodes
  const include = (items: WorldTreeNode[]): WorldTreeNode[] =>
    items.flatMap(node => {
      const children = include(node.children)
      if (node.entry.title.toLocaleLowerCase().includes(keyword) || children.length > 0)
        return [{ ...node, children }]
      return []
    })
  return include(nodes)
}

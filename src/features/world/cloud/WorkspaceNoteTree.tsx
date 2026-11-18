'use client'

import { useMemo, useState } from 'react'
import { TreeRow } from '@/components/shared/TreeRow'
import { BTN_QUIET, FIELD_INPUT } from '@/lib/ui-tokens'
import { useDelayedFlag } from '@/lib/use-delayed-flag'
import type { WorldEntry } from '@/types'
import { buildTree, type TreeNode } from '../components/world-tree-utils'
import { filterEntriesWithAncestors } from '../components/world-content-utils'

export function WorkspaceNoteTree({ entries, selectedId, busy, loading, error, onSelect, onCreate }: {
  entries: WorldEntry[]
  selectedId?: number
  busy: boolean
  loading: boolean
  error: string | null
  onSelect: (id: number) => void
  onCreate?: () => void
}) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const showLoading = useDelayedFlag(loading)
  const tree = useMemo(() => buildTree(filterEntriesWithAncestors(entries, query)), [entries, query])
  const selectedAncestors = useMemo(() => {
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    const ids = new Set<number>()
    let parent = selectedId === undefined ? null : byId.get(selectedId)?.parentId
    while (parent != null && !ids.has(parent)) {
      ids.add(parent)
      parent = byId.get(parent)?.parentId
    }
    return ids
  }, [entries, selectedId])

  function renderNode({ entry, children }: TreeNode, depth: number) {
    const open = expanded.has(entry.id) || selectedAncestors.has(entry.id) || query.trim() !== ''
    const select = () => { if (!busy) onSelect(entry.id) }
    return <div key={entry.id} role="none">
      <TreeRow title={entry.title} selected={entry.id === selectedId} depth={depth}
        onClick={select} expanded={open}
        rowProps={{ role: 'treeitem', 'aria-label': entry.title, 'aria-selected': entry.id === selectedId, 'aria-expanded': children.length ? open : undefined, tabIndex: 0,
          onKeyDown: event => {
            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
            event.preventDefault()
            select()
          },
        }}
        onToggleExpand={children.length && !selectedAncestors.has(entry.id) && !query.trim() ? () => {
          setExpanded(current => {
            const next = new Set(current)
            if (next.has(entry.id)) next.delete(entry.id)
            else next.add(entry.id)
            return next
          })
        } : undefined} />
      {open && children.length > 0 && <div role="group">{children.map(child => renderNode(child, depth + 1))}</div>}
    </div>
  }

  return <section className="flex flex-col gap-3 border-t border-line pt-5">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-reading font-semibold">世界观笔记</h2>
      {onCreate && <button type="button" className={BTN_QUIET} disabled={busy || loading || error !== null}
        onClick={onCreate}>新建笔记</button>}
    </div>
    {error && <p role="alert" className="text-ui text-error">{error}</p>}
    {showLoading && <p className="text-ui text-ink-muted">正在读取笔记…</p>}
    {!loading && entries.length > 0 && <>
      <input className={FIELD_INPUT} aria-label="搜索笔记" placeholder="搜索笔记"
        value={query} onChange={event => setQuery(event.target.value)} />
      <div role="tree" aria-label="世界观目录">{tree.map(node => renderNode(node, 0))}</div>
    </>}
    {!loading && !error && entries.length === 0 && <p className="text-ui text-ink-muted">暂无笔记</p>}
  </section>
}

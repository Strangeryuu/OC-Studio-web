'use client'

import { FolderOpen, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { NAV_GROUPS } from '@/lib/nav-sections'

const WORKSPACE_SECTIONS = {
  角色: 'character', 国家: 'country', 事件: 'event', 世界观: 'world', 表格: 'table', 地图: 'map', 时间线: 'timeline', 关系图: 'relations',
} as const

export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[keyof typeof WORKSPACE_SECTIONS] | 'members'

const cloudGroups = NAV_GROUPS.map(group => ({
  label: group.label,
  items: group.items.flatMap(item => {
    const section = WORKSPACE_SECTIONS[item.label as keyof typeof WORKSPACE_SECTIONS]
    return section ? [{ ...item, section }] : []
  }),
}))

export function WorkspaceNavigation({ active, busy, hasMembers, onSelect, onSwitchWorkspace }: {
  active: WorkspaceSection
  busy: boolean
  hasMembers: boolean
  onSelect: (section: WorkspaceSection) => void
  onSwitchWorkspace?: () => void
}) {
  function navItem(section: WorkspaceSection, label: string, Icon: LucideIcon) {
    return <button key={section} type="button" aria-current={section === active ? 'page' : undefined} disabled={busy}
      className={`relative flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-item px-3 text-left text-ui transition-colors md:w-full
        ${active === section ? 'bg-[var(--oc-hover)] text-ink' : 'text-ink-muted hover:bg-[var(--oc-hover)] hover:text-ink'}`}
      onClick={() => onSelect(section)}>
      <Icon size={16} strokeWidth={2} aria-hidden />
      {label}
    </button>
  }

  return <nav aria-label="工作台板块"
    className="flex gap-1 overflow-x-auto border-b border-line pb-3 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:pb-0 md:pr-3">
    {cloudGroups.map(group => <div key={group.label} className="flex shrink-0 gap-1 md:flex-col">
      <span className="hidden px-3 pb-0.5 pt-2 text-micro text-ink-faint md:block">{group.label}</span>
      {group.items.map(item => navItem(item.section, item.label, item.icon))}
    </div>)}
    {hasMembers && navItem('members', '成员与邀请', Users)}
    {onSwitchWorkspace && <button type="button" disabled={busy} onClick={onSwitchWorkspace}
      className="flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-item px-3 text-left text-ui text-ink-muted hover:bg-[var(--oc-hover)] hover:text-ink">
      <FolderOpen size={16} strokeWidth={2} aria-hidden />切换世界观
    </button>}
  </nav>
}

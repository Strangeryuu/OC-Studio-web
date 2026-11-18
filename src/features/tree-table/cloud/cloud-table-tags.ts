import type { Tag } from '@/types'
import type { CloudWorkspaceTag } from '@/lib/cloud/shared-tags'

type Taggable = { tags?: number[] }
type CloudTagged = { cloudTagIds?: unknown; cloudTags?: unknown }

/**
 * Original tree-table projections and badges are numeric-ID based.
 * Cloud tags use workspace-scoped UUIDs, so allocate ephemeral numeric display
 * IDs for this render only. Never send the synthetic values to the API.
 */
export function cloudTableTagProjection(
  workspaceTags: readonly CloudWorkspaceTag[],
  entities: readonly unknown[],
) {
  const tagsById = new Map<number, Tag>()
  const byUuid = new Map<string, number>()
  const byName = new Map<string, number>()
  let nextId = 1

  function add(name: string, color: string, uuid?: string): number {
    const existing = byName.get(name)
    if (existing !== undefined) {
      if (uuid) byUuid.set(uuid, existing)
      return existing
    }
    const id = nextId++
    tagsById.set(id, { id, name, color: color.toUpperCase(), category: '' })
    byName.set(name, id)
    if (uuid) byUuid.set(uuid, id)
    return id
  }

  for (const tag of workspaceTags.slice(0, 500)) {
    if (typeof tag.id === 'string' && typeof tag.name === 'string' &&
      typeof tag.color === 'string' && tag.name.length > 0) {
      add(tag.name, tag.color, tag.id)
    }
  }

  // Legacy cloudTags are names saved with the entity; preserve them even when
  // a shared tag has not yet been created. All additions are display-only.
  for (const value of entities) {
    if (!value || typeof value !== 'object') continue
    const names = (value as CloudTagged).cloudTags
    if (!Array.isArray(names)) continue
    for (const name of names.slice(0, 50)) {
      if (typeof name === 'string' && name.trim()) add(name.trim(), '')
    }
  }

  function decorate<T extends Taggable>(entity: T): T {
    const cloud = entity as T & CloudTagged
    const ids: number[] = []
    if (Array.isArray(cloud.cloudTagIds)) {
      for (const uuid of cloud.cloudTagIds) {
        if (typeof uuid !== 'string') continue
        const id = byUuid.get(uuid)
        if (id !== undefined && !ids.includes(id)) ids.push(id)
      }
    }
    if (Array.isArray(cloud.cloudTags)) {
      for (const name of cloud.cloudTags) {
        if (typeof name !== 'string') continue
        const id = byName.get(name.trim())
        if (id !== undefined && !ids.includes(id)) ids.push(id)
      }
    }
    return { ...entity, tags: ids }
  }

  return {
    tagsById, decorate,
    tagName: (ids: number[]): string => ids.map(id => tagsById.get(id)?.name ?? '').filter(Boolean).join(' '),
  }
}

export function readCloudWorkspaceTags(payload: unknown): CloudWorkspaceTag[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const items = (payload as Record<string, unknown>).tags
  if (!Array.isArray(items)) return []
  return items.filter((item): item is CloudWorkspaceTag =>
    item !== null && typeof item === 'object' && !Array.isArray(item) &&
    typeof item.id === 'string' && typeof item.name === 'string' &&
    /^#[0-9a-fA-F]{6}$/.test(String(item.color)),
  ).slice(0, 500)
}

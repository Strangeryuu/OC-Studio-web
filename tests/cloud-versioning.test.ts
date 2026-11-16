import { describe, expect, it } from 'vitest'
import { planEntityUpdate, type VersionedEntity } from '@/lib/cloud/versioning'

const base: VersionedEntity = {
  id: 'character-1',
  workspaceId: 'world-1',
  version: 12,
  content: { name: '羽', fields: { age: 14, occupation: '学生' } },
}

describe('cloud entity revision planning', () => {
  it('rejects stale edits without producing a revision', () => {
    expect(planEntityUpdate({
      current: base,
      expectedVersion: 11,
      nextContent: { name: '羽', fields: { age: 15 } },
      actorId: 'user-a',
      createdAt: '2026-11-16T00:00:00Z',
    })).toEqual({ kind: 'conflict', expectedVersion: 11, actualVersion: 12 })
  })

  it('ignores equivalent JSON with a different key order', () => {
    const result = planEntityUpdate({
      current: base,
      expectedVersion: 12,
      nextContent: { fields: { occupation: '学生', age: 14 }, name: '羽' },
      actorId: 'user-a',
      createdAt: '2026-11-16T00:00:00Z',
    })
    expect(result.kind).toBe('unchanged')
  })

  it('prepares an immutable, attributed full snapshot', () => {
    const nextContent = { name: '羽', fields: { age: 15, occupation: '学生' } }
    const result = planEntityUpdate({
      current: base,
      expectedVersion: 12,
      nextContent,
      actorId: 'user-a',
      createdAt: '2026-11-16T00:00:00Z',
    })
    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') return
    expect(result.next.version).toBe(13)
    expect(result.revision.version).toBe(13)
    expect(result.revision.actorId).toBe('user-a')
    expect(result.revision.contentSnapshot).toEqual(nextContent)
    nextContent.fields.age = 999
    expect(result.revision.contentSnapshot).toEqual({ name: '羽', fields: { age: 15, occupation: '学生' } })
    expect(base.version).toBe(12)
  })

  it('requires a verified actor and a valid base version', () => {
    expect(() => planEntityUpdate({
      current: base,
      expectedVersion: 12,
      nextContent: { name: '羽' },
      actorId: '',
      createdAt: '2026-11-16T00:00:00Z',
    })).toThrow('Authenticated actor is required')
    expect(() => planEntityUpdate({
      current: base,
      expectedVersion: 0,
      nextContent: { name: '羽' },
      actorId: 'user-a',
      createdAt: '2026-11-16T00:00:00Z',
    })).toThrow('Invalid expected version')
  })
})

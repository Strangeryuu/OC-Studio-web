import { describe, expect, it } from 'vitest'
import { cloudTableTagProjection, readCloudWorkspaceTags } from '@/features/tree-table/cloud/cloud-table-tags'

describe('cloud table tag projection', () => {
  const server = readCloudWorkspaceTags({
    tags: [
      { id: '11111111-1111-4111-8111-111111111111', name: '主角', color: '#4ecdc4' },
      { id: '22222222-2222-4222-8222-222222222222', name: '国家设定', color: '#ff6b6b' },
      { id: 'invalid', name: '无效', color: 'javascript:bad' },
    ],
  })
  it('converts workspace UUID tags to transient numeric display IDs', () => {
    const data = [
      { tags: [500], cloudTagIds: [server[0].id], cloudTags: ['旧标签'] },
      { tags: [], cloudTagIds: [server[1].id] },
    ]
    const projection = cloudTableTagProjection(server, data)
    const first = projection.decorate(data[0])
    const second = projection.decorate(data[1])
    expect(first.tags).toEqual([1, 3])
    expect(second.tags).toEqual([2])
    expect(projection.tagsById.get(1)?.name).toBe('主角')
    expect(projection.tagsById.get(1)?.color).toBe('#4ECDC4')
    expect(projection.tagName(first.tags!)).toBe('主角 旧标签')
    expect(data[0].tags).toEqual([500])
    expect(projection.tagsById.get(3)?.name).toBe('旧标签')
  })
  it('rejects malformed remote color data and never converts synthetic IDs back to entity data', () => {
    expect(server).toHaveLength(2)
    const projection = cloudTableTagProjection(server, [{ tags: [42], cloudTagIds: ['foreign-workspace-uuid'] }])
    expect(projection.decorate({ tags: [42], cloudTagIds: ['foreign-workspace-uuid'] }).tags).toEqual([])
    expect(projection.tagName([999])).toBe('')
  })
})

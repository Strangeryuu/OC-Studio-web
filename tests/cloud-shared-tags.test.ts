import { describe, expect, it } from 'vitest'
import { parseWorkspaceTag } from '@/lib/cloud/shared-tags'

describe('workspace tag validation', () => {
  it('normalizes valid names and color', () => {
    expect(parseWorkspaceTag({ name: '  战斗  ', color: '#AB12ef' }))
      .toEqual({ name: '战斗', color: '#ab12ef' })
  })
  it('rejects empty names, bad colors, and oversized names', () => {
    expect(parseWorkspaceTag({ name: '', color: '#abcdef' })).toBeNull()
    expect(parseWorkspaceTag({ name: 'x'.repeat(41), color: '#abcdef' })).toBeNull()
    expect(parseWorkspaceTag({ name: 'x', color: 'red' })).toBeNull()
  })
})

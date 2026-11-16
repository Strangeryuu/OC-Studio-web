import { describe, it, expect } from 'vitest'
import { readEntityDocument, isEntityKind, readExpectedVersion } from '@/lib/cloud/entity-input'

describe('cloud entity input', () => {
  it('accepts a valid character with custom fields', () => {
    expect(readEntityDocument({ title: ' 羽 ', data: { age: 14, custom: { ability: '光' } } }))
      .toEqual({ title: '羽', data: { age: 14, custom: { ability: '光' } } })
    expect(isEntityKind('character')).toBe(true)
  })
  it('rejects malformed input', () => {
    expect(readEntityDocument({ title: '', data: {} })).toBeNull()
    expect(readEntityDocument({ title: 'A', data: [] })).toBeNull()
    expect(readEntityDocument({ title: 'A', data: null })).toBeNull()
    expect(isEntityKind('DROP TABLE')).toBe(false)
    expect(readExpectedVersion(0)).toBeNull()
    expect(readExpectedVersion(2.5)).toBeNull()
    expect(readExpectedVersion(10)).toBe(10)
  })
})

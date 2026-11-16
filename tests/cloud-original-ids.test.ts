import { describe, expect, it } from 'vitest'
import { parseOriginalId } from '@/lib/cloud/original-ids'

describe('original UI numeric identifiers', () => {
  it('parses positive safe integers without rounding', () => {
    expect(parseOriginalId('1')).toBe(1)
    expect(parseOriginalId('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER)
    expect(parseOriginalId('9007199254740992')).toBeNull()
  })
  it('accepts zero only as the initial pagination cursor', () => {
    expect(parseOriginalId('0')).toBeNull()
    expect(parseOriginalId('0', true)).toBe(0)
  })
  it('rejects ambiguous or malformed values', () => {
    for (const value of ['01', '-1', '1.0', '1e3', '', ' 1', 'null', null, 1]) {
      expect(parseOriginalId(value, true)).toBeNull()
    }
  })
})

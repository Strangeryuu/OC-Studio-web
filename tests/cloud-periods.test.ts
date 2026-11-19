import { describe, expect, it } from 'vitest'
import { readPeriodFields, readWorkspacePeriods } from '@/lib/cloud/periods'

const period = { name: '帝国纪元', startTime: '200', endTime: '300', color: 'bg-warning' }

describe('cloud workspace periods', () => {
  it('preserves legacy numeric IDs and omits soft-deleted periods', () => {
    expect(readWorkspacePeriods([{ id: 7, ...period }, { id: 8, ...period, deleted: true }]))
      .toEqual([{ id: 7, ...period }])
  })
  it('rejects unsafe colors, reversed dates and invalid months', () => {
    expect(readPeriodFields({ ...period, color: 'bg-[url(http://host)]' })).toBeNull()
    expect(readPeriodFields({ ...period, endTime: '100' })).toBeNull()
    expect(readPeriodFields({ ...period, startTime: '200-19-01' })).toBeNull()
    expect(readPeriodFields({ ...period, name: ' ' })).toBeNull()
    expect(readPeriodFields({ ...period, startTime: '200-10', endTime: '200-2' })).toBeNull()
  })
  it('rejects duplicate IDs and oversized arrays', () => {
    expect(readWorkspacePeriods([{ id: 1, ...period }, { id: 1, ...period }])).toBeNull()
    expect(readWorkspacePeriods(Array.from({ length: 3001 }, (_, i) => ({
      id: i + 1, ...period,
    })))).toBeNull()
  })
  it('accepts BCE dates when start is earlier than end', () => {
    expect(readPeriodFields({ ...period, startTime: '-300', endTime: '-200' }))
      .toEqual({ ...period, startTime: '-300', endTime: '-200' })
    expect(readPeriodFields({ ...period, startTime: '-100', endTime: '-200' })).toBeNull()
  })
})

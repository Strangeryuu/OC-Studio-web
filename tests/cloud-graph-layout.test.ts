import { describe, expect, it } from 'vitest'
import { readGraphLayoutRequest } from '@/lib/cloud/graph-layout'

const one = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  entityType: 'character', localId: 1, expectedVersion: 2, x: 100.75, y: -8.75,
}
describe('atomic graph layout payload', () => {
  it('rounds position values and sorts UUIDs for consistent locking', () => {
    const next = { ...one, id: '550e8400-e29b-41d4-a716-446655440000', localId: 2 }
    expect(readGraphLayoutRequest({ positions: [one, next] })).toEqual([
      { ...next, x: 100.8, y: -8.7 },
      { ...one, x: 100.8, y: -8.7 },
    ])
  })
  it('rejects duplicates, invalid versions, coordinates, kinds, and huge batches', () => {
    expect(readGraphLayoutRequest({ positions: [one, one] })).toBeNull()
    expect(readGraphLayoutRequest({ positions: [{ ...one, expectedVersion: 0 }] })).toBeNull()
    expect(readGraphLayoutRequest({ positions: [{ ...one, entityType: 'map' }] })).toBeNull()
    expect(readGraphLayoutRequest({ positions: [{ ...one, x: Infinity }] })).toBeNull()
    expect(readGraphLayoutRequest({ positions: [{ ...one, x: 1e7 }] })).toBeNull()
    expect(readGraphLayoutRequest({ positions: [] })).toBeNull()
    expect(readGraphLayoutRequest({ positions: Array.from({ length: 1001 }, (_, i) =>
      ({ ...one, id: '550e8400-e29b-41d4-a716-' + (446655440000 + i) })) })).toBeNull()
  })
})

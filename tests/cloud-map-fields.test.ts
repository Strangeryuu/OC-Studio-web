import { describe, expect, it } from 'vitest'
import { validMapFields, normalizeMapAnchor } from '@/lib/cloud/map-fields'
import { characterMediaIds } from '@/lib/cloud/character-media'

const image = '/api/media/00000000-0000-4000-8000-000000000001'

describe('cloud maps: persisted data boundary', () => {
  it('accepts normalized positions and rejects out-of-range coordinates', () => {
    expect(normalizeMapAnchor({ x: 0.3, y: 0.75 })).toEqual({ x: 0.3, y: 0.75 })
    expect(normalizeMapAnchor({ x: -0.01, y: 0.5 })).toBeNull()
    expect(validMapFields('country', { mapId: '大陆', mapPosition: { x: 2, y: 0 } })).toBe(false)
    expect(validMapFields('event', { mapId: '大陆', mapPosition: { x: 0.2, y: 0.9 } })).toBe(true)
    expect(validMapFields('event', { mapId: '大陆' })).toBe(false)
    expect(validMapFields('event', { mapId: null, mapPosition: null })).toBe(true)
  })
  it('requires a private workspace media asset for a new background', () => {
    const base = { category: '地图', mapWidth: 1800, mapHeight: 900 }
    expect(validMapFields('worldEntry', { ...base, mapImage: image })).toBe(true)
    expect(validMapFields('worldEntry', { ...base, mapImage: 'https://other.site/map.png' })).toBe(false)
    expect(validMapFields('worldEntry', { category: '地图', mapImage: image })).toBe(false)
    expect(characterMediaIds('worldEntry', { ...base, mapImage: image })).toEqual([image.split('/').pop()])
  })
  it('restricts map-only fields to map entries', () => {
    expect(validMapFields('worldEntry', { category: '笔记', mapAnnotations: '[]' })).toBe(false)
    expect(validMapFields('worldEntry', { category: '笔记', mapPosition: { x: 0.2, y: 0.7 }, mapId: '大陆' })).toBe(true)
  })
  it('validates political lines and polygons', () => {
    const border = [{ id: 'b1', kind: 'border', points: [{x:0,y:0},{x:1,y:0},{x:0.5,y:1}] }]
    expect(validMapFields('worldEntry', { category: '地图', mapAnnotations: JSON.stringify(border) })).toBe(true)
    expect(validMapFields('worldEntry', { category: '地图', mapAnnotations: JSON.stringify([{...border[0], points: border[0].points.slice(0,2)}]) })).toBe(false)
    expect(validMapFields('worldEntry', { category: '地图', mapAnnotations: '{' })).toBe(false)
  })
})

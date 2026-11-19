import { describe, expect, it } from 'vitest'
import { rewriteMediaReferences } from '@/lib/cloud/media-rewrite'
import { validPresenceScope } from '@/lib/cloud/presence'
const old = '/api/media/11111111-1111-4111-8111-111111111111'
const next = '/api/media/22222222-2222-4222-8222-222222222222'
describe('global cloud image cleanup', () => {
  const original = {
    avatarUrl: old, headerUrl: 'https://example.invalid/unrelated.png',
    gallery: [{url:old,caption:'one'}, {url:'https://example.invalid/two.png'}],
    avatars: [old, 'keep.png'], mapImage: old,
    document: { type:'doc',content:[{type:'imageBlock',attrs:{src:old}},
      {type:'paragraph',content:[{type:'text',text:'keep'}]}] },
    content: JSON.stringify({ type:'doc',content:[{type:'imageBlock',attrs:{src:old}}] }),
    summary: 'A paragraph mentioning '+old+' in prose should remain unchanged.',
  }
  it('removes all references while preserving unrelated images and readable text', () => {
    const converted = rewriteMediaReferences(original,old,null)
    expect(converted.references).toBe(6)
    const data = converted.value
    expect(data.avatarUrl).toBe('')
    expect(data.mapImage).toBe('')
    expect(data.gallery).toEqual([{url:'https://example.invalid/two.png'}])
    expect(data.avatars).toEqual(['keep.png'])
    expect(data.document.content).toEqual([{type:'paragraph',content:[{type:'text',text:'keep'}]}])
    expect(JSON.parse(data.content).content).toEqual([])
    expect(data.summary).toBe(original.summary)
    expect(original.gallery).toHaveLength(2)
  })
  it('replaces exact references across entities and serialized TipTap bodies', () => {
    const converted = rewriteMediaReferences(original,old,next)
    expect(converted.references).toBe(6)
    expect(converted.value.avatarUrl).toBe(next)
    expect(converted.value.gallery[0].url).toBe(next)
    expect(JSON.parse(converted.value.content).content[0].attrs.src).toBe(next)
    expect(converted.value.headerUrl).toBe(original.headerUrl)
  })
  it('removes deleted map-view media without leaving invalid empty layer URLs', () => {
    const data = { mapViews: { terrain: old, contour: next }, mapImage: old }
    const removed = rewriteMediaReferences(data, old, null)
    expect(removed.references).toBe(2)
    expect(removed.value.mapViews).toEqual({ contour: next })
    const onlyLayer = rewriteMediaReferences({ mapViews: { terrain: old } }, old, null)
    expect(onlyLayer.value.mapViews).toBeNull()
  })
  it('keeps an unrelated asset untouched', () => {
    expect(rewriteMediaReferences(original,next,null)).toEqual({value:original,references:0})
  })
  it('validates presence scopes and rejects arbitrary user-supplied page names', () => {
    expect(validPresenceScope('category:cat-123')).toBe(true)
    expect(validPresenceScope('character')).toBe(true)
    expect(validPresenceScope('category:../other')).toBe(false)
    expect(validPresenceScope('world/../../../')).toBe(false)
  })
})

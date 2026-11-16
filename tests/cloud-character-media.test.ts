import { describe, expect, it } from 'vitest'
import { characterMediaIds } from '@/lib/cloud/character-media'

const a = '00000000-0000-4000-8000-000000000001'
const b = '00000000-0000-4000-8000-000000000002'
const c = '00000000-0000-4000-8000-000000000003'

describe('cloud character media references', () => {
  it('extracts deduplicated media references for database ownership checks', () => {
    expect(characterMediaIds('character', {
      avatarMediaId: a, headerMediaId: b,
      portraitMediaIds: [a, c], galleryMediaIds: [c],
      cloudTags: ['主角', '独立世界观'],
    })).toEqual([a,b,c])
  })
  it('allows older characters without cloud media fields', () => {
    expect(characterMediaIds('character', { name: '旧角色', avatars: ['/images/old.png'], tags: [1] })).toEqual([])
    expect(characterMediaIds('event', { avatarMediaId: 'legacy.png' })).toEqual([])
  })
  it('rejects path strings, malformed arrays and excessive media ids', () => {
    expect(characterMediaIds('character', { headerMediaId: '../../secret.png' })).toBeNull()
    expect(characterMediaIds('character', { galleryMediaIds: ['other-id'] })).toBeNull()
    expect(characterMediaIds('character', { portraitMediaIds: [a, a] })).toBeNull()
    expect(characterMediaIds('character', { portraitMediaIds: Array.from({ length: 25 }, () => a) })).toBeNull()
  })
  it('rejects excessively long, empty, and duplicate cloud tags', () => {
    expect(characterMediaIds('character', { cloudTags: ['', 'ok'] })).toBeNull()
    expect(characterMediaIds('character', { cloudTags: ['主角', '主角'] })).toBeNull()
    expect(characterMediaIds('character', { cloudTags: ['x'.repeat(41)] })).toBeNull()
  })
})

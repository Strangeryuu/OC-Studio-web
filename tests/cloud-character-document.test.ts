import { describe, it, expect } from 'vitest'
import { cloudCharacterFields, mergeCloudCharacter } from '@/lib/cloud/character-document'

describe('cloud character data mapping', () => {
  it('reads standard character fields with a valid Tiptap document', () => {
    const content = { name: '羽', race: '人类', custom: { ability: '光' },
      document: { type: 'doc', content: [{ type: 'paragraph' }] } }
    const fields = cloudCharacterFields(content, 'fallback')
    expect(fields.name).toBe('羽')
    expect(fields.document.type).toBe('doc')
    expect(fields.occupation).toBe('')
    expect(fields.avatarMediaId).toBeNull()
  })

  it('preserves unknown original OC Studio fields when saving basic fields', () => {
    const original = { name: '羽', countryId: 5, custom: { power: '火' }, relatedCharacters: [{ characterId: 3 }] }
    const fields = cloudCharacterFields(original, '羽')
    const merged = mergeCloudCharacter(original, { ...fields, name: '斯兰特·羽', occupation: '研究员' })
    expect(merged.name).toBe('斯兰特·羽')
    expect(merged.custom).toEqual({ power: '火' })
    expect(merged.relatedCharacters).toEqual([{ characterId: 3 }])
    expect(merged.countryId).toBe(5)
  })

  it('normalizes empty or malformed richtext safely', () => {
    const fields = cloudCharacterFields({ name: '角色', document: 'invalid', aliases: ['一', 4] }, '角色')
    expect(fields.document.type).toBe('doc')
    expect(fields.aliases).toEqual(['一'])
  })
})

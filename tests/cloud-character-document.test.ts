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

  it('retains custom facts even when a field is hidden from the shared template', () => {
    const original = {
      name: '羽', country: '旧国', isMajor: true,
      custom: { '灵子量': '很高', legacyScore: 88 },
    }
    const next = cloudCharacterFields(original, '羽')
    expect(next.country).toBe('旧国')
    expect(next.isMajor).toBe(true)
    expect(next.custom['灵子量']).toBe('很高')
    const result = mergeCloudCharacter(original, { ...next, occupation: '魔法师' })
    expect(result.custom).toEqual({ '灵子量': '很高', legacyScore: 88 })
    expect(result.isMajor).toBe(true)
  })


  it('persists distinct cover, portrait, gallery and text tag fields without rewriting legacy tags', () => {
    const avatarId = '00000000-0000-4000-8000-000000000001'
    const original = {
      name: '羽',
      tags: [42],
      avatars: [{ url: 'local/portrait.png' }],
      headerUrl: 'legacy/header.jpg',
      gallery: ['legacy/gallery.png'],
      custom: { 旧设定: '保留' },
    }
    const parsed = cloudCharacterFields(original, '羽')
    const saved = mergeCloudCharacter(original, {
      ...parsed,
      headerMediaId: avatarId,
      portraitMediaIds: [avatarId],
      galleryMediaIds: [avatarId],
      cloudTags: ['主角', '战斗'],
    })
    expect(saved.headerMediaId).toBe(avatarId)
    expect(saved.portraitMediaIds).toEqual([avatarId])
    expect(saved.galleryMediaIds).toEqual([avatarId])
    expect(saved.cloudTags).toEqual(['主角', '战斗'])
    expect(saved.tags).toEqual([42])
    expect(saved.headerUrl).toBe('legacy/header.jpg')
    expect(saved.avatars).toEqual([{ url: 'local/portrait.png' }])
    expect(saved.gallery).toEqual(['legacy/gallery.png'])
  })

  it('deduplicates text tags and caps media arrays when reading', () => {
    const parsed = cloudCharacterFields({
      cloudTags: ['  主角  ', '主角', '', '战斗'],
      portraitMediaIds: ['asset-a', 'asset-a'],
      galleryMediaIds: ['asset-b'],
    }, '角色')
    expect(parsed.cloudTags).toEqual(['主角', '战斗'])
    expect(parsed.portraitMediaIds).toEqual(['asset-a'])
    expect(parsed.galleryMediaIds).toEqual(['asset-b'])
  })


  it('keeps original numeric relationship and tag data while adding UUID associations', () => {
    const id = '00000000-0000-4000-8000-000000000001'
    const other = '00000000-0000-4000-8000-000000000002'
    const original = {
      name: '烟玖', tags: [31], relatedCharacters: [{ characterId: 72, relation: '表妹' }],
    }
    const parsed = cloudCharacterFields(original, '烟玖')
    const saved = mergeCloudCharacter(original, {
      ...parsed, cloudTagIds: [id],
      cloudRelations: [{ id, targetId: other, relation: '表妹', arrow: 'both' }],
    })
    expect(saved.relatedCharacters).toEqual(original.relatedCharacters)
    expect(saved.tags).toEqual([31])
    expect(saved.cloudTagIds).toEqual([id])
    expect(saved.cloudRelations).toHaveLength(1)
  })

  it('normalizes empty or malformed richtext safely', () => {
    const fields = cloudCharacterFields({ name: '角色', document: 'invalid', aliases: ['一', 4] }, '角色')
    expect(fields.document.type).toBe('doc')
    expect(fields.aliases).toEqual(['一'])
  })
})

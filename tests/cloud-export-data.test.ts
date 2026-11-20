import { describe, expect, it, vi } from 'vitest'
import type { Character, Country, Event, WorldEntry } from '@/types'

/** Guard cloud export against silently reading the local Dexie database. */
vi.mock('@/lib/db', () => ({
  db: {
    characters: { filter: () => { throw new Error('cloud export accessed local characters') } },
    events: { filter: () => { throw new Error('cloud export accessed local events') } },
    countries: { filter: () => { throw new Error('cloud export accessed local countries') } },
    worldEntries: { filter: () => { throw new Error('cloud export accessed local notes') } },
  },
}))

import { buildDocumentModelFromData, selectDocumentEntries } from '@/lib/export/document'
import { listPosterSubjects, loadPosterSubject } from '@/lib/export/poster/subjects'
import { buildSite } from '@/lib/export/site/build'

const character = {
  id: 10, name: '云端主角', aliases: ['小羽'], race: '精灵', element: '',
  occupation: '探索者', faction: '', nationalityLegacy: '', height: '', birthday: '',
  avatarUrl: '', headerUrl: '', bio: '来自甲世界的角色', lifeStory: '',
  gallery: [], avatars: [], relatedCharacters: [], tags: [], updatedAt: 20,
  countryId: 30,
} as Character
const event = {
  id: 20, title: '远征事件', aliases: [], time: '123', endTime: '',
  location: '山谷', summary: '一次冒险', content: '', characters: [10],
  countries: [30], headerUrl: '', images: [], tags: [], updatedAt: 21,
  relations: [], isMajor: false,
} as Event
const country = {
  id: 30, name: '云端国度', aliases: [], parentId: null, description: '河谷国度',
  system: '议会', geography: '', culture: '', flagUrl: '', headerUrl: '',
  tags: [], updatedAt: 19,
} as Country
const note = {
  id: 40, title: '世界法则', content: '设定正文', category: '世界观',
  parentId: null, relations: [], references: [], tags: [], updatedAt: 18,
} as WorldEntry
const source = { characters: [character], events: [event], countries: [country], entries: [note] }

describe('workspace export reuses the original model without Dexie reads', () => {
  it('lists and loads a cloud poster with named relationships', async () => {
    const list = await listPosterSubjects(source)
    expect(list.character.map(item => item.title)).toEqual(['云端主角'])
    expect(list.event[0].title).toBe('远征事件')
    const bundle = await loadPosterSubject('event', 20, source)
    expect(bundle?.data.title).toBe('远征事件')
    expect(bundle?.data.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '参与角色', value: '云端主角' }),
    ]))
    expect(await loadPosterSubject('character', 999, source)).toBeNull()
  })

  it('selects only current world rows for document preview and downloads', () => {
    const model = buildDocumentModelFromData({
      characters: [character], events: [event], countries: [country],
      worldEntries: [note], worldName: '甲世界',
    })
    expect(model.title).toBe('甲世界')
    expect(model.total).toBe(4)
    expect(model.sections.map(section => section.key)).toEqual(['characters', 'events', 'countries', 'world'])
    const chosen = selectDocumentEntries(model, { characters: true, events: true, countries: false, world: false },
      'picked', new Set(['角色:10']))
    expect(chosen.total).toBe(1)
    expect(chosen.sections[0].entries[0].title).toBe('云端主角')
    expect(chosen.sections[1].entries).toHaveLength(0)
  })

  it('generates a site only from supplied world records', () => {
    const html = buildSite({
      meta: { id: 1, worldName: '甲世界', tagline: '自己的故事', coverUrl: '', updatedAt: 0 },
      characters: [character], events: [event], countries: [country], worldEntries: [note],
      tags: [], periods: [],
    }, { images: new Map(), title: '甲世界' })
    expect(html).toContain('甲世界')
    expect(html).toContain('云端主角')
    expect(html).toContain('世界法则')
  })
})

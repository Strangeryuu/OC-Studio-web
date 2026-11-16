import { describe, expect, it } from 'vitest'
import { characterLinkIds, parseCloudRelations, parseCloudTagIds } from '@/lib/cloud/character-links'

const a='00000000-0000-4000-8000-000000000001'
const b='00000000-0000-4000-8000-000000000002'
const c='00000000-0000-4000-8000-000000000003'

describe('cloud character relationships and shared tags', () => {
  it('supports multiple named relationships to the same target', () => {
    const links = characterLinkIds('character', {
      cloudRelations: [
        {id:a,targetId:b,relation:'表姐',arrow:'both'},
        {id:c,targetId:b,relation:'保护者',arrow:'forward'},
      ],
      cloudTagIds: [a,b],
    }, c)
    expect(links).toEqual({targets:[b],tags:[a,b]})
  })
  it('rejects self-relationships, foreign malformed IDs, repeated IDs and unsupported arrow', () => {
    expect(characterLinkIds('character',{cloudRelations:[{id:a,targetId:b,relation:'朋友',arrow:'both'}]},b)).toBeNull()
    expect(parseCloudRelations([{id:a,targetId:'../secret',relation:'朋友',arrow:'both'}])).toBeNull()
    expect(parseCloudRelations([{id:a,targetId:b,relation:'朋友',arrow:'both'}, {id:a,targetId:c,relation:'敌人',arrow:'both'}])).toBeNull()
    expect(parseCloudRelations([{id:a,targetId:b,relation:'朋友',arrow:'hacker'}])).toBeNull()
  })
  it('validates UUID tag id assignments', () => {
    expect(parseCloudTagIds([a,b])).toEqual([a,b])
    expect(parseCloudTagIds([a,a])).toBeNull()
    expect(parseCloudTagIds(['bad-id'])).toBeNull()
    expect(parseCloudTagIds(Array(31).fill(a))).toBeNull()
  })
  it('supports legacy cloud characters that have only numeric relatedCharacters/tags', () => {
    expect(characterLinkIds('character',{tags:[14],relatedCharacters:[{characterId:10}]}))
      .toEqual({targets:[],tags:[]})
    expect(characterLinkIds('country',{cloudRelations:'old-value'}))
      .toEqual({targets:[],tags:[]})
  })
})

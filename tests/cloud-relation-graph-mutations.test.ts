// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Character, Country, Event, WorldEntry } from '@/types'
import type { EdgeStyleSelection } from '@/features/relations/components/EdgeStylePanel'
import {
  planWorkspaceRelationCreate, planWorkspaceRelationDelete, planWorkspaceRelationPatch,
  type WorkspaceGraphEntities, type WorkspaceGraphPlan,
} from '@/features/relations/cloud/workspace-graph-mutations'

const character = (id: number, name: string): Character =>
  ({ id, name, relatedCharacters: [], relatedNotes: [], countryId: undefined }) as unknown as Character
const event = (id: number, title: string): Event =>
  ({ id, title, characters: [], countries: [], relations: [] }) as unknown as Event
const country = (id: number): Country => ({ id, name: '国度' + id }) as Country
const note = (id: number, title: string): WorldEntry =>
  ({ id, title, relations: [] }) as unknown as WorldEntry
const rows = (): WorkspaceGraphEntities => ({
  characters: [character(1, '小羽'), character(2, '烟玖')],
  events: [event(3, '初次见面'), event(4, '再次相遇')],
  countries: [country(5)],
  notes: [note(6, '地图笔记'), note(7, '角色传记')],
})
function mustChange(plan: WorkspaceGraphPlan) {
  expect(plan.ok).toBe(true)
  if (!plan.ok || !plan.change) throw Error('Expected a persisted graph change')
  return plan.change
}
const selection = (sourceType: EdgeStyleSelection['sourceType'], sourceId: number,
  targetType: EdgeStyleSelection['targetType'], targetId: number,
  relation: string, kind: EdgeStyleSelection['kind'] = 'relation'): EdgeStyleSelection =>
  ({ sourceType, sourceId, targetType, targetId, relation, kind })

describe('cloud relation graph mutations', () => {
  it('creates parallel named character relationships in their original field', () => {
    const entities=rows()
    const one={entityType:'character' as const,entityId:1}
    const two={entityType:'character' as const,entityId:2}
    const first=mustChange(planWorkspaceRelationCreate(entities,one,two,'表姐妹'))
    expect(first).toEqual({type:'character',id:1,patch:{
      relatedCharacters:[{characterId:2,name:'烟玖',relation:'表姐妹',arrow:'both'}],
    }})
    if(first.type!=='character')throw Error('wrong target')
    entities.characters[0].relatedCharacters=first.patch.relatedCharacters!
    expect(planWorkspaceRelationCreate(entities,one,two,'表姐妹')).toEqual({ok:false,reason:'duplicate'})
    expect(mustChange(planWorkspaceRelationCreate(entities,one,two,'队友')).type).toBe('character')
  })

  it('styles, renames and deletes exactly one parallel relationship', () => {
    const entities=rows()
    entities.characters[0].relatedCharacters=[
      {characterId:2,name:'烟玖',relation:'朋友'},
      {characterId:2,name:'烟玖',relation:'同僚'},
    ]
    const picked=selection('character',1,'character',2,'朋友')
    const patched=mustChange(planWorkspaceRelationPatch(entities,picked,{relation:'师徒',arrow:'forward'}))
    expect(patched.type).toBe('character')
    if(patched.type!=='character')throw Error('wrong source')
    expect(patched.patch.relatedCharacters?.map(row=>row.relation)).toEqual(['师徒','同僚'])
    entities.characters[0].relatedCharacters=patched.patch.relatedCharacters!
    expect(planWorkspaceRelationPatch(entities,
      selection('character',1,'character',2,'师徒'),{relation:'同僚'}))
      .toEqual({ok:false,reason:'duplicate'})
    const deleted=mustChange(planWorkspaceRelationDelete(entities,
      selection('character',1,'character',2,'师徒')))
    if(deleted.type!=='character')throw Error('wrong source')
    expect(deleted.patch.relatedCharacters?.map(row=>row.relation)).toEqual(['同僚'])
  })

  it('resolves the recorded side for an existing reverse relationship', () => {
    const entities=rows()
    entities.characters[1].relatedCharacters=[{characterId:1,name:'小羽',relation:'盟友'}]
    const picked=selection('character',1,'character',2,'盟友')
    const patched=mustChange(planWorkspaceRelationPatch(entities,picked,{arrow:'both'}))
    expect(patched.type).toBe('character')
    expect(patched.id).toBe(2)
    const deleted=mustChange(planWorkspaceRelationDelete(entities,picked))
    expect(deleted.id).toBe(2)
  })

  it('maintains one source of truth for country and event memberships', () => {
    const entities=rows()
    const link=mustChange(planWorkspaceRelationCreate(entities,
      {entityType:'country',entityId:5},{entityType:'character',entityId:1},'属于'))
    expect(link).toEqual({type:'character',id:1,patch:{countryId:5}})
    entities.characters[0].countryId=5
    expect(planWorkspaceRelationCreate(entities,
      {entityType:'character',entityId:1},{entityType:'country',entityId:5},'属于'))
      .toEqual({ok:false,reason:'duplicate'})
    expect(mustChange(planWorkspaceRelationDelete(entities,
      selection('character',1,'country',5,'属于','member'))))
      .toEqual({type:'character',id:1,patch:{countryId:null}})
    expect(mustChange(planWorkspaceRelationCreate(entities,
      {entityType:'character',entityId:2},{entityType:'event',entityId:3},'参与')))
      .toEqual({type:'event',id:3,patch:{characters:[2]}})
    expect(mustChange(planWorkspaceRelationCreate(entities,
      {entityType:'country',entityId:5},{entityType:'event',entityId:4},'发生于')))
      .toEqual({type:'event',id:4,patch:{countries:[5]}})
  })

  it('supports existing named note edges and protects derived references', () => {
    const entities=rows()
    entities.notes[0].relations=[{targetId:7,name:'角色传记',relation:'相关'}]
    const picked=selection('world',6,'world',7,'相关')
    const renamed=mustChange(planWorkspaceRelationPatch(entities,picked,{relation:'关联资料'}))
    expect(renamed.type).toBe('world')
    if(renamed.type!=='world')throw Error('wrong source')
    expect(renamed.patch.relations?.[0].relation).toBe('关联资料')
    expect(planWorkspaceRelationDelete(entities,
      selection('world',6,'world',7,'引用','reference')))
      .toEqual({ok:false,reason:'unsupported'})
    expect(planWorkspaceRelationCreate(entities,
      {entityType:'country',entityId:5},{entityType:'country',entityId:5},'相关'))
      .toEqual({ok:false,reason:'unsupported'})
  })
})

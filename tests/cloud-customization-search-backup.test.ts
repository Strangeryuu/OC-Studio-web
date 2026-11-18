import { describe, expect, it } from 'vitest'
import { defaultWorkspaceCustomization, readWorkspaceCustomization } from '@/lib/cloud/workspace-customization'
import { indexCloudWorkspaceSearch } from '@/lib/cloud/workspace-search'
import { parsePortableBackup, remapPortableContent } from '@/lib/cloud/backup-format'

const workspaceA='11111111-1111-4111-8111-111111111111'
const cloudUUID='22222222-2222-4222-8222-222222222222'
describe('cloud templates, categories, original global search and portable backups',()=>{
  it('loads original built-in categories and templates and enforces stable reserved names',()=>{
    const defaults=defaultWorkspaceCustomization()
    expect(readWorkspaceCustomization(defaults)).toEqual(defaults)
    expect(defaults.templates.find(t=>t.id==='pet')?.components.some(c=>c.params?.group==='group-pet')).toBe(true)
    const next=structuredClone(defaults)
    next.categories.push({id:'cat-new',name:'神器',template:'weapon',icon:'swords',order:4,enabled:true})
    expect(readWorkspaceCustomization(next)?.categories).toHaveLength(3)
    next.categories[2].name='小说'
    expect(readWorkspaceCustomization(next)).toBeNull()
    next.categories[2].name='神器'
    next.categories[2].template='character'
    expect(readWorkspaceCustomization(next)).toBeNull()
    next.categories[2].template='weapon'
    next.templates[0].components.push(next.templates[0].components[0])
    expect(readWorkspaceCustomization(next)).toBeNull()
  })
  it('ranks original multiword alias, field and TipTap body matches across types',()=>{
    const records=[
      {id:workspaceA,local_id:1,kind:'character',title:'凌空',content:{aliases:['天枢'],race:'古龙'}},
      {id:cloudUUID,local_id:2,kind:'worldEntry',title:'晶河',content:{category:'小说',document:{
        type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'星海深处的古龙'}]}]}}},
      {id:'33333333-3333-4333-8333-333333333333',local_id:3,kind:'event',title:'古龙苏醒',
        content:{time:'0001',summary:'古代传说'}},
    ]
    expect(indexCloudWorkspaceSearch(records,'古龙')[0].title).toBe('古龙苏醒')
    expect(indexCloudWorkspaceSearch(records,'天枢 古龙').map(h=>h.kind)).toEqual(['character'])
    expect(indexCloudWorkspaceSearch(records,'星海 古龙')[0]).toMatchObject({kind:'novel',matched:'body'})
    expect(indexCloudWorkspaceSearch(records,'不存在')).toEqual([])
  })
  it('reads an original v1 .ocbak and remaps numeric references without collisions',()=>{
    const legacy={version:1,data:{characters:[{id:1,name:'角色',countryId:1}],
      countries:[{id:1,name:'国家'}],events:[],worldEntries:[],tags:[],periods:[],meta:[]}}
    const parsed=parsePortableBackup(legacy)
    expect(parsed?.source).toBe('legacy')
    expect(parsed?.records.map(r=>r.sourceId)).toEqual(['character:1','country:1'])
    const withExtras=parsePortableBackup({...legacy,
      data:{...legacy.data,periods:[{id:8,name:'旧时纪'}],meta:[{id:1,worldName:'旧世界'}]},
      config:{inspirations:[{id:'original-inspiration',title:'不丢失的灵感'}]},
      journal:['{"ts":"2026-11-18T00:00:00Z"}'],
    })
    const extras=withExtras?.settings.find(item=>item.key==='desktop-extras')?.value as
      {periods:unknown[];meta:unknown[];config:Record<string,unknown>;journal:string[]}
    expect(extras.periods).toHaveLength(1)
    expect(extras.meta).toHaveLength(1)
    expect(extras.config.inspirations).toHaveLength(1)
    expect(extras.journal).toHaveLength(1)
    const local=new Map([['character:1',12],['country:1',13]])
    const output=remapPortableContent('character',{name:'角色',countryId:1},{local,
      uuid:new Map(),media:new Map(),tags:new Map()})
    expect(output.countryId).toBe(13)
    expect(()=>remapPortableContent('character',{countryId:5},{local,
      uuid:new Map(),media:new Map(),tags:new Map()})).toThrow('BACKUP_REFERENCE_MISSING')
  })
  it('rejects malformed cloud sidecars and accepts a revision-preserving archive',()=>{
    const basic={version:1,data:{characters:[],countries:[],events:[],worldEntries:[],
      tags:[],periods:[],meta:[]}}
    const cloud={format:'oc-studio-web-v1',sourceWorkspaceId:workspaceA,
      records:[{id:cloudUUID,localId:9,kind:'worldEntry',title:'故事',content:{title:'故事',parentId:null},
        version:1,deletedAt:null,history:[{version:1,action:'create',
          content:{title:'故事',data:{title:'故事',parentId:null}}}]}],
      assets:[],tags:[],settings:[]}
    expect(parsePortableBackup({...basic,cloud})?.records[0].history).toHaveLength(1)
    expect(parsePortableBackup({...basic,cloud:{...cloud,records:[{...cloud.records[0],kind:'injected'}]}}))
      .toBeNull()
    expect(parsePortableBackup({...basic,cloud:{format:'unknown'}})).toBeNull()
    expect(parsePortableBackup({...basic,cloud:{...cloud,records:[{
      ...cloud.records[0],version:2,
    }]}})).toBeNull()
    expect(parsePortableBackup({...basic,cloud:{...cloud,records:[{
      ...cloud.records[0],history:[{...cloud.records[0].history[0],createdAt:'not-a-date'}],
    }]}})).toBeNull()
  })
})

// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const state=vi.hoisted(()=>({db:null as PGlite|null}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/cloud/server/db',()=>{
  const query=(sql:string,params?:unknown[])=>state.db!.query(sql,params)
  return {pool:{query,connect:async()=>({query,release:()=>{}})}}
})
vi.mock('@/lib/cloud/server/media-store',()=>({
  readPrivateImage:async()=>{throw new Error('unexpected media')},
  writePrivateImage:async()=>{throw new Error('unexpected media')},
  removePrivateImage:async()=>{},
}))

import { exportCategoryArchive, previewCategoryImport, importCategoryArchive } from '@/lib/cloud/server/category-archive-io'
import { convertOcEditorCategory } from '@/lib/cloud/oc-editor-category'
import type { CategoryArchive } from '@/lib/cloud/category-archive'

const source='11111111-1111-4111-8111-111111111111'
const target='22222222-2222-4222-8222-222222222222'
const other='33333333-3333-4333-8333-333333333333'
const imported='44444444-4444-4444-8444-444444444444'
const overwrittenWorld='66666666-6666-4666-8666-666666666666'
const userId='owner'
async function insert(workspaceId:string,kind:string,title:string,content:Record<string,unknown>) {
  const r=await state.db!.query<{id:string;local_id:string}>(
    'INSERT INTO entities(workspace_id,kind,title,content,created_by,updated_by) '+
    'VALUES($1,$2,$3,$4::jsonb,$5,$5) RETURNING id,local_id::text',
    [workspaceId,kind,title,JSON.stringify(content),userId])
  return {id:r.rows[0].id,localId:Number(r.rows[0].local_id)}
}
async function rows(workspaceId:string) {
  const result=await state.db!.query<{kind:string;title:string;content:Record<string,unknown>;version:number}>(
    'SELECT kind,title,content,version FROM entities WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY local_id',[workspaceId])
  return result.rows
}
function char(name:string,folder:string,extra:Record<string,unknown>={}):Record<string,unknown> {
  return {name,folder,aliases:[],race:'',element:'',occupation:'',faction:'',
    nationalityLegacy:'',height:'',birthday:'',avatarUrl:'',bio:'',lifeStory:'',
    relatedCharacters:[],relatedNotes:[],gallery:[],avatars:[],tags:[],...extra}
}

describe('PostgreSQL category archives use one atomic scope and ID mapping',()=>{
  beforeAll(async()=>{
    process.env.BETTER_AUTH_SECRET ??= 'ocstudio-category-import-integration-test-only-secret'
    state.db=new PGlite()
    await state.db.exec('CREATE TABLE "user"(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,role TEXT DEFAULT \'user\',banned BOOLEAN NOT NULL DEFAULT false)')
    for(const file of readdirSync('cloud/migrations').filter(f=>f.endsWith('.sql')).sort())
      await state.db.exec(readFileSync('cloud/migrations/'+file,'utf8'))
    await state.db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',
      [userId,'owner','owner@example.test'])
    for(const id of [source,target,other,imported,overwrittenWorld]) {
      await state.db.query('INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)',
        [id,userId,'Test World'])
    }
  })
  afterAll(async()=>{await state.db?.close()})
  it('exports selected characters and necessary country/character context only',async()=>{
    const country=await insert(source,'country','雾之国',{name:'雾之国'})
    const friend=await insert(source,'character','友人',char('友人','配角'))
    await insert(source,'character','主角',char('主角','主角组',{
      countryId:country.localId,relatedCharacters:[{characterId:friend.localId,name:'友人',relation:'盟友'}],
    }))
    await insert(source,'event','私有事件',{title:'私有事件'})
    const file=await exportCategoryArchive(source,'原始世界',{kind:'character',folder:'主角组'})
    expect(file.records.map(r=>r.title).sort()).toEqual(['雾之国','友人','主角'].sort())
    expect(file.records.some(r=>r.title==='私有事件')).toBe(false)
    expect(file.assets).toHaveLength(0)
    const preview=await previewCategoryImport(target,userId,file)
    expect(preview).toMatchObject({selected:1,context:2,total:3,duplicates:0})
    const result=await importCategoryArchive(target,userId,file,'skip')
    expect(result).toMatchObject({added:3,skipped:0,media:0})
    const after=await rows(target)
    const lead=after.find(r=>r.title==='主角')!
    const resident=after.find(r=>r.title==='雾之国')!
    const ally=after.find(r=>r.title==='友人')!
    const sourceLead=file.records.find(r=>r.title==='主角')!
    expect(lead.content.countryId).not.toBe(sourceLead.content.countryId)
    const idCountry=await state.db!.query<{local_id:string}>(
      'SELECT local_id::text FROM entities WHERE workspace_id=$1 AND title=$2',[target,'雾之国'])
    expect(lead.content.countryId).toBe(Number(idCountry.rows[0].local_id))
    const allyId=await state.db!.query<{local_id:string}>(
      'SELECT local_id::text FROM entities WHERE workspace_id=$1 AND title=$2',[target,'友人'])
    expect((lead.content.relatedCharacters as {characterId:number}[])[0].characterId)
      .toBe(Number(allyId.rows[0].local_id))
    expect(resident).toBeDefined();expect(ally).toBeDefined()
    const folders=await state.db!.query<{setting_value:string[]}>(
      "SELECT setting_value FROM workspace_settings WHERE workspace_id=$1 AND setting_key='character-folders'",[target])
    expect(folders.rows[0].setting_value.sort()).toEqual(['主角组','配角'].sort())
    expect(await rows(other)).toHaveLength(0)
  })
  it('skips duplicates without modifying target, and maps other references to retained rows',async()=>{
    const file=await exportCategoryArchive(source,'原始世界',{kind:'character',folder:'主角组'})
    const pre=await previewCategoryImport(target,userId,file)
    expect(pre.duplicates).toBe(3)
    const before=await rows(target)
    const outcome=await importCategoryArchive(target,userId,file,'skip')
    expect(outcome).toMatchObject({added:0,skipped:3})
    expect(await rows(target)).toEqual(before)
  })
  it('keep-both renames conflicting records and makes a separate valid graph',async()=>{
    const file=await exportCategoryArchive(source,'原始世界',{kind:'character',folder:'主角组'})
    const outcome=await importCategoryArchive(target,userId,file,'keep-both')
    expect(outcome).toMatchObject({added:3,renamed:3})
    const now=await rows(target)
    expect(now.map(x=>x.title)).toContain('主角（导入）')
    const duplicate=now.find(x=>x.title==='主角（导入）')!
    const newCountry=await state.db!.query<{local_id:string}>(
      'SELECT local_id::text FROM entities WHERE workspace_id=$1 AND title=$2',[target,'雾之国（导入）'])
    expect(duplicate.content.countryId).toBe(Number(newCountry.rows[0].local_id))
  })
  it('creates a safe default category in target without replacing existing templates',async()=>{
    await insert(source,'worldEntry','魔法剑',{title:'魔法剑',category:'神器',content:'神话级武器'})
    const file=await exportCategoryArchive(source,'原始世界',{kind:'worldEntry',category:'神器'})
    const outcome=await importCategoryArchive(other,userId,file,'skip')
    expect(outcome.added).toBe(1)
    const setting=await state.db!.query<{setting_value:{categories:{name:string;template:string;enabled:boolean}[]}}>(
      "SELECT setting_value FROM workspace_settings WHERE workspace_id=$1 AND setting_key='customization'",[other])
    expect(setting.rows[0].setting_value.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({name:'神器',template:'entry',enabled:true}),
    ]))
    expect((await rows(other)).map(row=>row.title)).toContain('魔法剑')
  })
  it('imports an unmodified OC-editor native character archive with multi-edge context and groups',async()=>{
    const native={
      format:'oc-editor-ocav',version:1,kind:'character',exportedAt:'2026-11-20T05:00:00Z',
      world:{name:'原版编辑器'},
      payload:{
        table:'characters',contextMode:'create',
        items:[{id:1,name:'星河',bio:'长篇背景',aliases:[],countryId:3,
          folderId:'main-group',avatarUrl:'',relatedCharacters:[{
            characterId:2,name:'日影',relation:'盟友',
          }],tags:[7]}],
        context:{characters:[{id:2,name:'日影',bio:'配角',avatarUrl:'',relatedCharacters:[]}],
          countries:[{id:3,name:'苍穹国',system:'王国',flagUrl:''}],events:[],worldEntries:[],
          tags:[{id:7,name:'联盟',color:'#123abc'}]},
        folders:[{id:'main-group',name:'核心角色'}],
        refs:[{type:'character',id:1,name:'星河'}],
      },
      relations:[{sourceType:'character',sourceId:1,targetType:'character',targetId:2,
        kind:'character',label:'誓约',directed:false,color:'#445566',arrow:'both'}],
    }
    const parsed=convertOcEditorCategory(native)!
    expect(parsed.records).toHaveLength(3)
    const pre=await previewCategoryImport(imported,userId,native)
    expect(pre).toMatchObject({sourceFormat:'oc-editor-ocav',selected:1,total:3,duplicates:0,
      relations:1,unresolved:0})
    const result=await importCategoryArchive(imported,userId,native,'skip')
    expect(result).toMatchObject({added:3,skipped:0})
    const now=await rows(imported)
    const lead=now.find(row=>row.title==='星河')!
    const countryId=await state.db!.query<{local_id:string}>(
      "SELECT local_id::text FROM entities WHERE workspace_id=$1 AND title='苍穹国'",[imported])
    expect(lead.content.countryId).toBe(Number(countryId.rows[0].local_id))
    const otherId=await state.db!.query<{local_id:string}>(
      "SELECT local_id::text FROM entities WHERE workspace_id=$1 AND title='日影'",[imported])
    expect((lead.content.relatedCharacters as {characterId:number;relation:string}[])
      .filter(edge=>edge.characterId===Number(otherId.rows[0].local_id))
      .map(edge=>edge.relation).sort()).toEqual(['盟友','誓约'])
    expect(lead.content.folder).toBe('核心角色')
    expect((lead.content.cloudTagIds as string[])).toHaveLength(1)
    const folder=await state.db!.query<{setting_value:string[]}>(
      "SELECT setting_value FROM workspace_settings WHERE workspace_id=$1 AND setting_key='character-folders'",[imported])
    expect(folder.rows[0].setting_value).toContain('核心角色')
    const repeated=await importCategoryArchive(imported,userId,native,'skip')
    expect(repeated).toMatchObject({added:0,skipped:3})
  })
  it('resolves link-only OC-editor refs inside the target without copying unrelated entities',async()=>{
    const native={
      format:'oc-editor-ocav',version:1,kind:'world-entry',
      exportedAt:'2026-11-20T06:00:00Z',world:{name:'笔记来源'},
      payload:{table:'worldEntries',contextMode:'link-only',
        items:[{id:77,title:'誓约史',category:'史书',content:'古老契约',
          references:[{targetType:'character',targetId:1}]}],
        context:{tags:[]},folders:[],refs:[{type:'character',id:1,name:'星河'}]},
      relations:[],
    }
    const pre=await previewCategoryImport(imported,userId,native)
    expect(pre).toMatchObject({sourceFormat:'oc-editor-ocav',linked:1,unresolved:0})
    const result=await importCategoryArchive(imported,userId,native,'skip')
    expect(result.added).toBe(1)
    const entry=(await rows(imported)).find(row=>row.title==='誓约史')!
    const id=await state.db!.query<{local_id:string}>(
      "SELECT local_id::text FROM entities WHERE workspace_id=$1 AND title='星河'",[imported])
    expect(entry.content.references).toEqual([{
      targetType:'character',targetId:Number(id.rows[0].local_id),
    }])
    expect((await rows(imported)).filter(row=>row.kind==='character')).toHaveLength(2)
  })
  it('converts custom-section scoped edges into visible categorized Web world entries',async()=>{
    const file={
      format:'oc-editor-ocav',version:1,kind:'custom-section',exportedAt:'2026-11-20T07:00:00Z',
      world:{name:'自定义分类世界'},
      payload:{table:'customSections',contextMode:'link-only',context:{tags:[]},
        folders:[],refs:[],items:[{
          id:'custom-001',name:'古物',entries:[
            {id:'item-a',name:'戒指',note:'魔法戒指',gallery:[]},
            {id:'item-b',name:'魔法石',note:'神秘力量',gallery:[]},
          ],scopedEdges:[{source:'item-a',target:'item-b',label:'镶嵌'}],
        }]},relations:[],
    }
    const pre=await previewCategoryImport(imported,userId,file)
    expect(pre).toMatchObject({selected:2,context:0,sourceFormat:'oc-editor-ocav'})
    const result=await importCategoryArchive(imported,userId,file,'skip')
    expect(result.added).toBe(2)
    const found=await rows(imported)
    expect(found.filter(x=>x.kind==='worldEntry'&&x.content.category==='古物').map(x=>x.title))
      .toEqual(['戒指','魔法石'])
    const ring=found.find(x=>x.title==='戒指')!
    const stone=await state.db!.query<{local_id:string}>(
      "SELECT local_id::text FROM entities WHERE workspace_id=$1 AND title='魔法石'",[imported])
    expect((ring.content.relations as {targetId:number;relation:string}[])[0]).toMatchObject({
      targetId:Number(stone.rows[0].local_id),relation:'镶嵌',
    })
  })
  it('overwrites matching rows in place only with a signed snapshot and increments versions',async()=>{
    const file=await exportCategoryArchive(source,'版本化来源',{kind:'character',folder:'主角组'})
    for(const record of file.records){
      const old={...record.content,...(record.kind==='character'?{bio:'覆盖前的独立编辑'}:{})}
      await insert(overwrittenWorld,record.kind,record.title,old)
    }
    const baseline=await state.db!.query<{id:string;local_id:string;title:string;version:number}>(
      'SELECT id,local_id::text,title,version FROM entities WHERE workspace_id=$1 ORDER BY local_id',
      [overwrittenWorld])
    const pre=await previewCategoryImport(overwrittenWorld,userId,file)
    expect(pre).toMatchObject({duplicates:3,overwriteCount:3,total:3})
    expect(typeof pre.previewToken).toBe('string')
    await expect(importCategoryArchive(overwrittenWorld,userId,file,'overwrite'))
      .rejects.toThrow('CATEGORY_PREVIEW_INVALID')
    const result=await importCategoryArchive(overwrittenWorld,userId,file,'overwrite',pre.previewToken)
    expect(result).toMatchObject({added:0,overwritten:3,skipped:0,renamed:0})
    const after=await state.db!.query<{id:string;local_id:string;title:string;version:number}>(
      'SELECT id,local_id::text,title,version FROM entities WHERE workspace_id=$1 ORDER BY local_id',
      [overwrittenWorld])
    expect(after.rows.map(row=>[row.id,row.local_id]))
      .toEqual(baseline.rows.map(row=>[row.id,row.local_id]))
    expect(after.rows.every((row,i)=>row.version===baseline.rows[i].version+1)).toBe(true)
    const entries=await rows(overwrittenWorld)
    expect(entries.find(row=>row.title==='主角')!.content.bio).toBe('')
    const friendLocal=Number(after.rows.find(row=>row.title==='友人')!.local_id)
    expect((entries.find(row=>row.title==='主角')!.content.relatedCharacters as
      {characterId:number}[])[0].characterId).toBe(friendLocal)
  })
  it('rejects a stale target-version preview without partially overwriting any entry',async()=>{
    const file=await exportCategoryArchive(source,'版本化来源',{kind:'character',folder:'主角组'})
    const pre=await previewCategoryImport(overwrittenWorld,userId,file)
    await state.db!.query(
      "UPDATE entities SET content=jsonb_set(content,'{bio}','\"其他用户编辑\"'::jsonb),"+
      "version=version+1 WHERE workspace_id=$1 AND title='主角'",
      [overwrittenWorld])
    const before=await rows(overwrittenWorld)
    await expect(importCategoryArchive(overwrittenWorld,userId,file,'overwrite',pre.previewToken))
      .rejects.toThrow('CATEGORY_PREVIEW_STALE')
    expect(await rows(overwrittenWorld)).toEqual(before)
  })
  it('binds the overwrite ticket to the exact archive, world and operator',async()=>{
    const file=await exportCategoryArchive(source,'版本化来源',{kind:'character',folder:'主角组'})
    const pre=await previewCategoryImport(overwrittenWorld,userId,file)
    const tampered={...file,sourceName:'被更改的归档'}
    await expect(importCategoryArchive(overwrittenWorld,userId,tampered,'overwrite',pre.previewToken))
      .rejects.toThrow('CATEGORY_PREVIEW_STALE')
    await expect(importCategoryArchive(other,userId,file,'overwrite',pre.previewToken))
      .rejects.toThrow('CATEGORY_PREVIEW_INVALID')
    await expect(importCategoryArchive(overwrittenWorld,'wrong-operator',file,'overwrite',pre.previewToken))
      .rejects.toThrow('CATEGORY_PREVIEW_INVALID')
    const result=await importCategoryArchive(overwrittenWorld,userId,file,'overwrite',pre.previewToken)
    expect(result.overwritten).toBe(3)
  })
  it('rolls back all inserts and imported tags on an unresolved foreign reference',async()=>{
    const before=await rows(target)
    const fresh:CategoryArchive={
      format:'oc-studio-web-category-v1',version:1,sourceName:'不可信备份',
      exportedAt:'2026-11-20T01:00:00Z',selection:{kind:'character'},
      records:[{kind:'character',sourceId:'44444444-4444-4444-8444-444444444444',
        localId:300,title:'坏角色',content:char('坏角色','', {countryId:99999})}],
      assets:[],tags:[{id:'55555555-5555-4555-8555-555555555555',name:'临时标签',color:'#aabbcc'}],
    }
    await expect(importCategoryArchive(target,userId,fresh,'skip')).rejects.toThrow('BACKUP_REFERENCE_MISSING')
    expect(await rows(target)).toEqual(before)
    const tags=await state.db!.query<{name:string}>(
      'SELECT name FROM workspace_tags WHERE workspace_id=$1',[target])
    expect(tags.rows).toHaveLength(0)
  })
})

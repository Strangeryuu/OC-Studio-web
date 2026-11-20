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
import type { CategoryArchive } from '@/lib/cloud/category-archive'

const source='11111111-1111-4111-8111-111111111111'
const target='22222222-2222-4222-8222-222222222222'
const other='33333333-3333-4333-8333-333333333333'
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
    state.db=new PGlite()
    await state.db.exec('CREATE TABLE "user"(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,role TEXT DEFAULT \'user\',banned BOOLEAN NOT NULL DEFAULT false)')
    for(const file of readdirSync('cloud/migrations').filter(f=>f.endsWith('.sql')).sort())
      await state.db.exec(readFileSync('cloud/migrations/'+file,'utf8'))
    await state.db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',
      [userId,'owner','owner@example.test'])
    for(const id of [source,target,other]) {
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
    const preview=await previewCategoryImport(target,file)
    expect(preview).toMatchObject({selected:2,total:3,duplicates:0})
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
    expect(await rows(other)).toHaveLength(0)
  })
  it('skips duplicates without modifying target, and maps other references to retained rows',async()=>{
    const file=await exportCategoryArchive(source,'原始世界',{kind:'character',folder:'主角组'})
    const pre=await previewCategoryImport(target,file)
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

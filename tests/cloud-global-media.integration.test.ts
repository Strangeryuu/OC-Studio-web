// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const state = vi.hoisted(() => ({
  db: null as PGlite | null,
  user: { id:'ci-owner' } as {id:string}|null,
  authorized: true,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/cloud/server/db', () => {
  const query = (sql:string, params?:unknown[]) => state.db!.query(sql,params)
  return {pool:{query,connect:async()=>({query,release:()=>{}})}}
})
vi.mock('@/lib/cloud/server/authorization', () => ({
  currentCloudUser:async()=>state.user,
  isUuid:(id:unknown)=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id),
  authorizedWorkspace:async()=>state.authorized ? 'owner' : null,
}))
vi.mock('@/lib/cloud/server/origin', () => ({
  mutationOriginAllowed:(request:Request)=>request.headers.get('origin')==='http://localhost:3000',
}))
import * as api from '@/app/api/workspaces/[workspaceId]/media/[assetId]/route'
const workspace='660e8400-e29b-41d4-a716-446655440001'
const foreignWorkspace='660e8400-e29b-41d4-a716-446655440002'
const asset='440e8400-e29b-41d4-a716-446655440001'
const nextAsset='440e8400-e29b-41d4-a716-446655440002'
const character='550e8400-e29b-41d4-a716-446655440001'
const event='550e8400-e29b-41d4-a716-446655440002'
const outsider='550e8400-e29b-41d4-a716-446655440003'
const oldUrl='/api/media/'+asset
const newUrl='/api/media/'+nextAsset
const ctx={params:Promise.resolve({workspaceId:workspace,assetId:asset})}
function get() {return api.GET(new Request('http://localhost:3000/media-preview'),ctx)}
function edit(method:'DELETE'|'PATCH',data:Record<string,unknown>,origin='http://localhost:3000') {
  const request=new Request('http://localhost:3000/media-delete',{
    method,headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(data),
  })
  return method==='DELETE'?api.DELETE(request,ctx):api.PATCH(request,ctx)
}
async function snapshot() {
  const rows=await state.db!.query<{id:string;version:number;content:Record<string,unknown>}>(
    'SELECT id,version,content FROM entities ORDER BY id')
  return rows.rows
}
const before=()=>({
  confirmEverywhere:true, expectedVersions:{[character]:1,[event]:1}, coverVersion:3,
})
describe('global image delete and replace with PostgreSQL transaction',()=>{
  beforeAll(async()=>{
    state.db=new PGlite()
    await state.db.exec(
      'CREATE TABLE workspaces(id UUID PRIMARY KEY,deleted_at TIMESTAMPTZ);'+
      'CREATE TABLE media_assets(id UUID PRIMARY KEY,workspace_id UUID,deleted_at TIMESTAMPTZ);'+
      'CREATE TABLE entities(id UUID PRIMARY KEY,workspace_id UUID,title TEXT,kind TEXT,'+
      'content JSONB,version INTEGER,updated_by TEXT,updated_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ);'+
      'CREATE TABLE workspace_settings(workspace_id UUID,setting_key TEXT,setting_value JSONB,'+
      'version INTEGER,updated_at TIMESTAMPTZ);'+
      'CREATE TABLE entity_revisions(entity_id UUID,version INTEGER,actor_id TEXT,'+
      'action TEXT,summary TEXT,content_snapshot JSONB);'+
      'CREATE TABLE change_events(entity_id UUID,version INTEGER,actor_id TEXT,'+
      'action TEXT,changes JSONB);'+
      'CREATE TABLE audit_logs(workspace_id UUID,actor_id TEXT,action TEXT,target_id TEXT,details JSONB);'
    )
    await state.db.query('INSERT INTO workspaces(id) VALUES($1),($2)',[workspace,foreignWorkspace])
  })
  beforeEach(async()=>{
    state.user={id:'ci-owner'}
    state.authorized=true
    await state.db!.exec(
      'TRUNCATE media_assets,entities,workspace_settings,entity_revisions,change_events,audit_logs')
    await state.db!.query(
      'INSERT INTO media_assets(id,workspace_id) VALUES($1,$2),($3,$2)',[asset,workspace,nextAsset])
    await state.db!.query(
      'INSERT INTO entities(id,workspace_id,title,kind,content,version) VALUES'+
      "($1,$2,'Hero','character',$3::jsonb,1),"+
      "($4,$2,'Event','event',$5::jsonb,1),"+
      "($6,$7,'Foreign','country',$8::jsonb,1)",
      [character,workspace,JSON.stringify({avatarUrl:oldUrl,document:{
        type:'doc',content:[{type:'imageBlock',attrs:{src:oldUrl}}]}}),
      event,JSON.stringify({images:[{url:oldUrl,caption:'shared'}],headerUrl:'untouched'}),
      outsider,foreignWorkspace,JSON.stringify({flagUrl:oldUrl})])
    await state.db!.query(
      "INSERT INTO workspace_settings(workspace_id,setting_key,setting_value,version) VALUES($1,'world-cover',$2::jsonb,3)",
      [workspace,JSON.stringify(oldUrl)])
  })
  afterAll(async()=>{await state.db?.close()})

  it('previews exact affected entities without exposing foreign workspaces',async()=>{
    const response=await get()
    expect(response.status).toBe(200)
    const body=await response.json()
    expect(body.affected.map((row:{id:string})=>row.id)).toEqual([character,event])
    expect(body.references).toBe(4)
    expect(body.coverVersion).toBe(3)
  })
  it('rejects stale previews, missing confirmation, cross-origin writes and unauthorized actors',async()=>{
    expect((await edit('DELETE',{...before(),expectedVersions:{[character]:8,[event]:1}})).status).toBe(409)
    expect((await edit('DELETE',before(),'https://other.example')).status).toBe(403)
    expect((await edit('DELETE',{...before(),confirmEverywhere:false})).status).toBe(400)
    state.authorized=false
    expect((await edit('DELETE',before())).status).toBe(404)
    expect((await snapshot()).every(row=>row.version===1)).toBe(true)
  })
  it('removes every matching link, soft-deletes the asset and keeps revisions',async()=>{
    const result=await edit('DELETE',before())
    expect(result.status).toBe(200)
    const entities=await snapshot()
    const hero=entities.find(row=>row.id===character)!
    const evt=entities.find(row=>row.id===event)!
    expect(hero.version).toBe(2)
    expect(hero.content.avatarUrl).toBe('')
    expect((hero.content.document as {content:unknown[]}).content).toEqual([])
    expect(evt.content.images).toEqual([])
    expect(entities.find(row=>row.id===outsider)?.content.flagUrl).toBe(oldUrl)
    const settings=await state.db!.query<{setting_value:unknown;version:number}>(
      'SELECT setting_value,version FROM workspace_settings WHERE workspace_id=$1',[workspace])
    expect(settings.rows[0]).toMatchObject({setting_value:'',version:4})
    const media=await state.db!.query<{deleted_at:string|null}>(
      'SELECT deleted_at FROM media_assets WHERE id=$1',[asset])
    expect(media.rows[0].deleted_at).toBeTruthy()
    const rev=await state.db!.query('SELECT * FROM entity_revisions')
    expect(rev.rows).toHaveLength(2)
    expect((await get()).status).toBe(404)
  })
  it('replaces all references with a validated asset while preserving other fields',async()=>{
    const response=await edit('PATCH',{...before(),replaceWith:nextAsset})
    expect(response.status).toBe(200)
    const rows=await snapshot()
    expect(rows.find(row=>row.id===character)?.content.avatarUrl).toBe(newUrl)
    expect((rows.find(row=>row.id===event)?.content.images as Array<{url:string}>)[0].url).toBe(newUrl)
    expect(rows.find(row=>row.id===event)?.content.headerUrl).toBe('untouched')
  })
})

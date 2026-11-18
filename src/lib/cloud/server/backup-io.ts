import 'server-only'
import { Buffer } from 'node:buffer'
import { pool } from '@/lib/cloud/server/db'
import { readPrivateImage, writePrivateImage, removePrivateImage } from '@/lib/cloud/server/media-store'
import { detectAllowedImage, MAX_UPLOAD_BYTES } from '@/lib/cloud/image-types'
import { readWorkspaceCustomization } from '@/lib/cloud/workspace-customization'
import { parsePortableBackup, remapPortableContent, type ImportIdMaps, type PortableBackup } from '@/lib/cloud/backup-format'
import { readEntityDocument } from '@/lib/cloud/entity-input'
import type { PoolClient } from 'pg'

const MAX_EXPORT_BYTES=60*1024*1024
const MAX_RECORDS=3000
const ALLOWED_SETTINGS=['customization','world-cover','character-config'] as const
interface Row {id:string;local_id:string|number;kind:string;title:string;content:Record<string,unknown>;
  version:number;deleted_at:string|null}
interface Rev {entity_id:string;version:number;action:'create'|'update'|'delete'|'restore';summary:string|null;
  created_at:string;content_snapshot:Record<string,unknown>}
interface Asset {id:string;mime_type:string;storage_key:string}
interface Tag {id:string;name:string;color:string}
type Setting={setting_key:string;setting_value:unknown}
const obj=(value:unknown):value is Record<string,unknown>=>
  !!value&&typeof value==='object'&&!Array.isArray(value)
const error=(code:string)=>new Error(code)
function walkReplace(value:unknown, lookup:Map<string,string>):unknown{
  if(typeof value==='string')return lookup.get(value)??value
  if(Array.isArray(value))return value.map(item=>walkReplace(item,lookup))
  if(obj(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,walkReplace(v,lookup)]))
  return value
}

/** Export an original v1 .ocbak plus a faithful cloud sidecar for cross-VPS recovery. */
export async function exportWorkspaceBackup(workspaceId:string,workspaceName:string):Promise<string>{
  const [entities,tags,settings,media] = await Promise.all([
    pool.query<Row>(`SELECT id,local_id,kind,title,content,version,deleted_at FROM entities
      WHERE workspace_id=$1 ORDER BY local_id LIMIT 3001`,[workspaceId]),
    pool.query<Tag>('SELECT id,name,color FROM workspace_tags WHERE workspace_id=$1 ORDER BY name LIMIT 1001',[workspaceId]),
    pool.query<Setting>(`SELECT setting_key,setting_value FROM workspace_settings
      WHERE workspace_id=$1 AND setting_key=ANY($2::text[])`,[workspaceId,ALLOWED_SETTINGS]),
    pool.query<Asset>(`SELECT id,mime_type,storage_key FROM media_assets
      WHERE workspace_id=$1 ORDER BY id LIMIT 501`,[workspaceId]),
  ])
  if(entities.rows.length>MAX_RECORDS||tags.rows.length>1000||media.rows.length>500)
    throw error('BACKUP_TOO_LARGE')
  const ids=entities.rows.map(row=>row.id)
  const revisions=ids.length?await pool.query<Rev>(`SELECT entity_id,version,action,summary,created_at,content_snapshot
      FROM entity_revisions WHERE entity_id=ANY($1::uuid[]) ORDER BY entity_id,version LIMIT 30001`,[ids]):{rows:[] as Rev[]}
  if(revisions.rows.length>30000)throw error('BACKUP_HISTORY_TOO_LARGE')
  const history=new Map<string,Rev[]>()
  for(const rev of revisions.rows)history.set(rev.entity_id,[...(history.get(rev.entity_id)??[]),rev])
  const mediaInline=new Map<string,string>()
  const assets=[]
  let bytesTotal=0
  for(const item of media.rows){
    const bytes=await readPrivateImage(item.storage_key)
    bytesTotal+=bytes.byteLength
    if(bytesTotal>MAX_EXPORT_BYTES)throw error('BACKUP_TOO_LARGE')
    const base64=Buffer.from(bytes).toString('base64')
    mediaInline.set('/api/media/'+item.id,'data:'+item.mime_type+';base64,'+base64)
    assets.push({id:item.id,mime:item.mime_type,base64})
  }
  const asLegacy=(row:Row)=>{
    const transformed=walkReplace(row.content,mediaInline) as Record<string,unknown>
    return {...transformed,id:Number(row.local_id),deleted:row.deleted_at!==null}
  }
  const records=entities.rows.map(row=>({
    id:row.id,localId:Number(row.local_id),kind:row.kind,title:row.title,
    content:row.content,version:row.version,deletedAt:row.deleted_at,
    history:(history.get(row.id)??[]).map(rev=>({
      version:rev.version,action:rev.action,summary:rev.summary,
      createdAt:rev.created_at,content:rev.content_snapshot,
    })),
  }))
  const active=(kind:string)=>entities.rows.filter(row=>row.kind===kind&&row.deleted_at===null).map(asLegacy)
  const config=settings.rows.find(item=>item.setting_key==='customization')
  const content={
    version:1,exportedAt:new Date().toISOString(),
    data:{characters:active('character'),events:active('event'),
      countries:active('country'),worldEntries:active('worldEntry'),
      tags:tags.rows.map((tag,i)=>({...tag,id:i+1})),periods:[],meta:[]},
    ...(config&&obj(config.setting_value)?{config:{
      categories:config.setting_value.categories,templates:config.setting_value.templates,
    }}:{}),
    cloud:{format:'oc-studio-web-v1',sourceWorkspaceId:workspaceId,sourceName:workspaceName,
      records,assets,tags:tags.rows,settings:settings.rows.map(item=>({
        key:item.setting_key,value:item.setting_value,
      })),
      note:'Cloud import remaps identities and reassigns historical actors to the importing admin.'},
  }
  const json=JSON.stringify(content)
  if(Buffer.byteLength(json)>MAX_EXPORT_BYTES*2)throw error('BACKUP_TOO_LARGE')
  return json
}

/** Safe, target-empty restore. No existing entity or tag can be overwritten. */
export async function importWorkspaceBackup(workspaceId:string,actorId:string,raw:unknown){
  const backup=parsePortableBackup(raw)
  if(!backup)throw error('INVALID_BACKUP')
  if(backup.records.length>MAX_RECORDS)throw error('BACKUP_TOO_LARGE')
  const client=await pool.connect()
  const written:string[]=[]
  try{
    await client.query('BEGIN')
    const lock=await client.query('SELECT id FROM workspaces WHERE id=$1 AND deleted_at IS NULL FOR NO KEY UPDATE',[workspaceId])
    if(lock.rowCount!==1)throw error('WORKSPACE_MISSING')
    const existing=await client.query<{n:string}>(`SELECT (
      (SELECT COUNT(*) FROM entities WHERE workspace_id=$1)+
      (SELECT COUNT(*) FROM media_assets WHERE workspace_id=$1)+
      (SELECT COUNT(*) FROM workspace_tags WHERE workspace_id=$1)+
      (SELECT COUNT(*) FROM workspace_settings WHERE workspace_id=$1)
    )::text AS n`,[workspaceId])
    if(Number(existing.rows[0]?.n??1)>0)throw error('RESTORE_TARGET_NOT_EMPTY')
    const maps:ImportIdMaps={local:new Map(),uuid:new Map(),media:new Map(),tags:new Map()}
    const inline=new Map<string,string>()
    let mediaBytes=0
    const writeAsset=async(bytes:Uint8Array,mime:string)=>{
      mediaBytes+=bytes.byteLength
      if(mediaBytes>MAX_EXPORT_BYTES)throw error('BACKUP_TOO_LARGE')
      const detected=bytes.byteLength<=MAX_UPLOAD_BYTES?detectAllowedImage(bytes):null
      if(!detected||detected.mime!==mime)throw error('INVALID_BACKUP_MEDIA')
      const saved=await writePrivateImage(workspaceId,bytes)
      written.push(saved.storageKey)
      const added=await client.query<{id:string}>(`INSERT INTO media_assets(
        workspace_id,uploaded_by,storage_key,mime_type,byte_size,content_sha256)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [workspaceId,actorId,saved.storageKey,saved.kind.mime,saved.size,saved.sha256])
      return added.rows[0].id
    }
    for(const media of backup.assets){
      const bytes=Uint8Array.from(Buffer.from(media.base64,'base64'))
      maps.media.set(media.id.toLowerCase(),await writeAsset(bytes,media.mime))
    }
    // Original .ocbak embeds images as data URIs, including inside TipTap JSON.
    const collect=(item:unknown,seen:Set<string>,depth=0):void=>{
      if(depth>22)return
      if(typeof item==='string'){
        if(/^data:image\/(png|jpeg|gif|webp);base64,/i.test(item))seen.add(item)
      }else if(Array.isArray(item)){for(const v of item)collect(v,seen,depth+1)}
      else if(obj(item)){for(const v of Object.values(item))collect(v,seen,depth+1)}
    }
    const embedded=new Set<string>()
    for(const row of backup.records){
      collect(row.content,embedded)
      for(const history of row.history)collect(history.content,embedded)
    }
    for(const setting of backup.settings)collect(setting.value,embedded)
    if(embedded.size>500)throw error('BACKUP_TOO_LARGE')
    for(const uri of embedded){
      const matched=/^data:(image\/(?:png|jpeg|gif|webp));base64,(.*)$/is.exec(uri)
      if(!matched)throw error('INVALID_BACKUP_MEDIA')
      const id=await writeAsset(new Uint8Array(Buffer.from(matched[2],'base64')),matched[1].toLowerCase())
      inline.set(uri,'/api/media/'+id)
      // Embedded legacy images have already been uploaded into this workspace.
      // Retain strict foreign-ID rejection while permitting these newly minted URLs.
      maps.media.set(id,id)
    }
    const tagNumeric=new Map<number,string>()
    for(const tag of backup.tags){
      const added=await client.query<{id:string}>(`INSERT INTO workspace_tags(workspace_id,name,color,created_by)
       VALUES($1,$2,$3,$4) RETURNING id`,[workspaceId,tag.name,tag.color,actorId])
      maps.tags.set(tag.id,added.rows[0].id)
      if(tag.legacyId!==undefined)tagNumeric.set(tag.legacyId,added.rows[0].id)
    }
    for(const row of backup.records){
      const added=await client.query<{id:string;local_id:string}>(`INSERT INTO entities(
        workspace_id,kind,title,content,version,created_by,updated_by)
        VALUES($1,$2,$3,'{}'::jsonb,1,$4,$4) RETURNING id,local_id`,
        [workspaceId,row.kind,row.title,actorId])
      maps.uuid.set(row.sourceId,added.rows[0].id)
      maps.local.set(row.kind+':'+row.localId,Number(added.rows[0].local_id))
    }
    const transformed=(kind:string,data:Record<string,unknown>)=>{
      const withInline=walkReplace(data,inline) as Record<string,unknown>
      const converted=remapPortableContent(kind,withInline,maps)
      if(backup.source==='legacy'&&Array.isArray(converted.tags)){
        converted.cloudTagIds=converted.tags.map(id=>tagNumeric.get(Number(id))).filter(Boolean)
      }
      return converted
    }
    for(const row of backup.records){
      const id=maps.uuid.get(row.sourceId)!
      const data=transformed(row.kind,row.content)
      const doc=readEntityDocument({title:row.title,data})
      if(!doc)throw error('INVALID_IMPORTED_ENTITY')
      const version=row.history.length?row.version:1
      await client.query(`UPDATE entities SET title=$1,content=$2::jsonb,version=$3,
        deleted_at=$4,updated_at=now() WHERE id=$5 AND workspace_id=$6`,[
        doc.title,JSON.stringify(doc.data),version,row.deletedAt,id,workspaceId])
      const revisions=row.history.length?row.history:[{
        version:1,action:'create' as const,summary:'从 .ocbak 导入',
        content:{title:row.title,data:row.content},
      }]
      for(const revision of revisions){
        const sourceDoc=revision.content
        const migrated=readEntityDocument({
          title:sourceDoc.title,data:transformed(row.kind,sourceDoc.data as Record<string,unknown>),
        })
        if(!migrated)throw error('INVALID_IMPORTED_HISTORY')
        await client.query(`INSERT INTO entity_revisions(entity_id,version,actor_id,action,summary,content_snapshot,created_at)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz)`,[id,revision.version,actorId,revision.action,
          revision.summary??'从 .ocbak 导入',JSON.stringify(migrated),
          revision.createdAt??new Date().toISOString()])
        await client.query(`INSERT INTO change_events(entity_id,version,actor_id,action,changes,created_at)
          VALUES($1,$2,$3,$4,'[]'::jsonb,$5::timestamptz)`,[
          id,revision.version,actorId,revision.action,
          revision.createdAt??new Date().toISOString()])
      }
    }
    for(const setting of backup.settings){
      let value=walkReplace(setting.value,inline)
      value=walkReplace(value,new Map([...maps.media.entries()].map(([from,to])=>
        ['/api/media/'+from,'/api/media/'+to])))
      if(setting.key==='customization'&&!readWorkspaceCustomization(value))throw error('INVALID_CUSTOMIZATION')
      await client.query(`INSERT INTO workspace_settings(workspace_id,setting_key,setting_value,version)
        VALUES($1,$2,$3::jsonb,1)`,[workspaceId,setting.key,JSON.stringify(value)])
    }
    await client.query(`INSERT INTO audit_logs(workspace_id,actor_id,action,target_id,details)
      VALUES($1,$2,'workspace:backup:import',$3,$4::jsonb)`,[workspaceId,actorId,workspaceId,
      JSON.stringify({source:backup.source,records:backup.records.length,
        media:backup.assets.length+embedded.size,tags:backup.tags.length})])
    await client.query('COMMIT')
    return {restored:backup.records.length,media:backup.assets.length+embedded.size,
      tags:backup.tags.length,source:backup.source,
      warning:'历史操作者统一记录为当前导入管理员；原始 UUID 与数字 ID 已重新映射。'}
  }catch(cause){
    await client.query('ROLLBACK')
    await Promise.all(written.map(key=>removePrivateImage(key).catch(()=>undefined)))
    throw cause
  }finally{client.release()}
}

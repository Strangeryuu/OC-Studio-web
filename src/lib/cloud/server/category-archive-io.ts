import 'server-only'
import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { pool } from '@/lib/cloud/server/db'
import { readPrivateImage, writePrivateImage, removePrivateImage } from '@/lib/cloud/server/media-store'
import { detectAllowedImage, MAX_UPLOAD_BYTES } from '@/lib/cloud/image-types'
import { readEntityDocument } from '@/lib/cloud/entity-input'
import { remapPortableContent } from '@/lib/cloud/backup-format'
import { characterMediaIds } from '@/lib/cloud/character-media'
import { characterMediaAllowed } from '@/lib/cloud/server/character-media'
import { characterLinksAllowed } from '@/lib/cloud/server/character-links'
import { eventLinksAllowed } from '@/lib/cloud/server/original-links'
import { worldLinksAllowed } from '@/lib/cloud/server/world-links'
import { cloudMapAllowed } from '@/lib/cloud/map-fields'
import { cloudNovelAllowed } from '@/lib/cloud/novel-fields'
import { CATEGORY_FORMAT, collectCategoryClosure, collectArchiveMedia,
  parseCategoryArchive, recordKey, type CategoryRecord, type CategoryArchive,
  type CategorySelection, type CategoryStrategy } from '@/lib/cloud/category-archive'
import type { PoolClient } from 'pg'

const MAX_ARCHIVE_BYTES = 40_000_000
type SourceRow = {id:string;local_id:string;kind:string;title:string;content:Record<string,unknown>}
type TargetRow = {id:string;local_id:string;kind:string;title:string;content:Record<string,unknown>;version:number}
type MediaRow = {id:string;mime_type:string;storage_key:string}
type TagRow = {id:string;name:string;color:string}
function fail(code:string):never { throw new Error(code) }
function isOriginalKind(kind:string):kind is CategoryRecord['kind'] {
  return kind==='character'||kind==='event'||kind==='country'||kind==='worldEntry'
}
function normalizeSource(rows:SourceRow[]):CategoryRecord[] {
  return rows.filter(r=>isOriginalKind(r.kind)).map(r=>({
    sourceId:r.id.toLowerCase(),localId:Number(r.local_id),
    kind:r.kind as CategoryRecord['kind'],title:r.title,content:r.content,
  }))
}
function cleanForImport(kind:string, data:Record<string,unknown>):Record<string,unknown> {
  const next={...data}
  // Original numeric tag IDs are local to the source Dexie store.
  if (Array.isArray(next.tags)) next.tags=[]
  if (kind==='character' && Array.isArray(next.cloudRelations)) {
    next.cloudRelations=next.cloudRelations.map(relation=>
      relation&&typeof relation==='object'&&!Array.isArray(relation)
        ? {...relation as Record<string,unknown>, id:randomUUID()} : relation)
  }
  return next
}
async function categoryRows(workspaceId:string):Promise<CategoryRecord[]> {
  const result=await pool.query<SourceRow>(
    "SELECT id,local_id::text,kind,title,content FROM entities WHERE workspace_id=$1 "+
    "AND kind=ANY($2::text[]) AND deleted_at IS NULL ORDER BY local_id LIMIT 3001",
    [workspaceId,['character','event','country','worldEntry']])
  if(result.rows.length>3000)fail('CATEGORY_TOO_LARGE')
  return normalizeSource(result.rows)
}

export async function categoryExportOptions(workspaceId:string) {
  const rows=await categoryRows(workspaceId)
  const unique=(values:string[])=>[...new Set(values)].sort((a,b)=>a.localeCompare(b,'zh-CN'))
  const active=rows.filter(row=>row.kind!=='worldEntry' ||
    !['小说','地图'].includes(String(row.content.category??'')))
  return {
    counts:{
      character:active.filter(row=>row.kind==='character').length,
      event:active.filter(row=>row.kind==='event').length,
      country:active.filter(row=>row.kind==='country').length,
      worldEntry:active.filter(row=>row.kind==='worldEntry').length,
    },
    folders:unique(active.filter(row=>row.kind==='character')
      .map(row=>String(row.content.folder??'').trim()).filter(Boolean)),
    categories:unique(active.filter(row=>row.kind==='worldEntry')
      .map(row=>String(row.content.category??'').trim()).filter(Boolean)),
  }
}

export async function exportCategoryArchive(
  workspaceId:string, sourceName:string, selection:CategorySelection,
):Promise<CategoryArchive> {
  const records=await categoryRows(workspaceId)
  const allowed=records.filter(row=>row.kind!=='worldEntry'||!['小说','地图'].includes(String(row.content.category??'')))
  const {rows,primary}=collectCategoryClosure(allowed,selection)
  if(primary===0)fail('CATEGORY_EMPTY')
  const ids=collectArchiveMedia(rows)
  for(const row of rows) {
    const extra=characterMediaIds(row.kind,row.content)
    if(extra===null)fail('CATEGORY_MEDIA_INVALID')
    for(const id of extra)ids.add(id.toLowerCase())
  }
  if(ids.size>100)fail('CATEGORY_TOO_LARGE')
  const media=ids.size ? await pool.query<MediaRow>(
    "SELECT id,mime_type,storage_key FROM media_assets WHERE workspace_id=$1 "+
    "AND id=ANY($2::uuid[]) AND deleted_at IS NULL",
    [workspaceId,[...ids]]) : {rows:[] as MediaRow[]}
  if(media.rows.length!==ids.size)fail('CATEGORY_MEDIA_MISSING')
  let size=0
  const assets:CategoryArchive['assets']=[]
  for(const asset of media.rows) {
    const bytes=await readPrivateImage(asset.storage_key)
    size+=bytes.byteLength
    if(size>MAX_ARCHIVE_BYTES-500_000||bytes.byteLength>MAX_UPLOAD_BYTES)fail('CATEGORY_TOO_LARGE')
    const identified=detectAllowedImage(bytes)
    if(!identified||identified.mime!==asset.mime_type)fail('CATEGORY_MEDIA_INVALID')
    assets.push({id:asset.id,mime:asset.mime_type,base64:Buffer.from(bytes).toString('base64')})
  }
  const tagIds=new Set<string>()
  for(const row of rows) {
    if(Array.isArray(row.content.cloudTagIds)) {
      for(const id of row.content.cloudTagIds) {
        if(typeof id!=='string')fail('CATEGORY_TAG_INVALID')
        tagIds.add(id.toLowerCase())
      }
    }
  }
  const tags=tagIds.size ? await pool.query<TagRow>(
    "SELECT id,name,color FROM workspace_tags WHERE workspace_id=$1 AND id=ANY($2::uuid[])",
    [workspaceId,[...tagIds]]) : {rows:[] as TagRow[]}
  if(tags.rows.length!==tagIds.size)fail('CATEGORY_TAG_MISSING')
  const archive:CategoryArchive={
    format:CATEGORY_FORMAT,version:1,sourceName,exportedAt:new Date().toISOString(),
    selection, records:rows,assets,tags:tags.rows,
  }
  const encoded=JSON.stringify(archive)
  if(Buffer.byteLength(encoded)>MAX_ARCHIVE_BYTES)fail('CATEGORY_TOO_LARGE')
  if(!parseCategoryArchive(archive))fail('CATEGORY_INVALID')
  return archive
}

function chooseTarget(archive:CategoryArchive, existing:TargetRow[]) {
  const lookup=new Map<string,TargetRow[]>()
  for(const row of existing) {
    if(!isOriginalKind(row.kind))continue
    const key=recordKey(row.kind,row.title,row.content)
    const list=lookup.get(key)??[]
    list.push(row);lookup.set(key,list)
  }
  const seen=new Set<string>()
  let duplicates=0
  for(const row of archive.records) {
    const key=recordKey(row.kind,row.title,row.content)
    if(seen.has(key))fail('CATEGORY_AMBIGUOUS_SOURCE')
    seen.add(key)
    const matches=lookup.get(key)??[]
    if(matches.length>1)fail('CATEGORY_AMBIGUOUS_TARGET')
    if(matches.length)duplicates++
  }
  return {lookup,duplicates}
}
async function targetRows(client:PoolClient,workspaceId:string):Promise<TargetRow[]> {
  const existing=await client.query<TargetRow>(
    "SELECT id,local_id::text,kind,title,content,version FROM entities "+
    "WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY local_id FOR UPDATE",
    [workspaceId])
  return existing.rows
}

export async function previewCategoryImport(workspaceId:string,raw:unknown) {
  const archive=parseCategoryArchive(raw)
  if(!archive)fail('CATEGORY_INVALID')
  const existing=await pool.query<TargetRow>(
    "SELECT id,local_id::text,kind,title,content,version FROM entities "+
    "WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY local_id",
    [workspaceId])
  const {duplicates}=chooseTarget(archive,existing.rows)
  return {
    sourceName:archive.sourceName,kind:archive.selection.kind,
    selected:archive.records.filter(row=>row.kind===archive.selection.kind).length,
    total:archive.records.length,context:archive.records.filter(row=>row.kind!==archive.selection.kind).length,
    media:archive.assets.length,duplicates,addable:archive.records.length-duplicates,
  }
}

export async function importCategoryArchive(
  workspaceId:string,actorId:string,raw:unknown,strategy:CategoryStrategy,
) {
  const archive=parseCategoryArchive(raw)
  if(!archive||!['skip','keep-both'].includes(strategy))fail('CATEGORY_INVALID')
  const client=await pool.connect()
  const written:string[]=[]
  let started=false
  try {
    await client.query('BEGIN');started=true
    const locked=await client.query(
      'SELECT id FROM workspaces WHERE id=$1 AND deleted_at IS NULL FOR NO KEY UPDATE',[workspaceId])
    if(locked.rowCount!==1)fail('NOT_FOUND')
    const existing=await targetRows(client,workspaceId)
    const {lookup}=chooseTarget(archive,existing)
    const usedKeys=new Set(existing.filter(r=>isOriginalKind(r.kind))
      .map(r=>recordKey(r.kind as CategoryRecord['kind'],r.title,r.content)))
    const maps={
      local:new Map<string,number>(),uuid:new Map<string,string>(),
      media:new Map<string,string>(),tags:new Map<string,string>(),
    }
    const incoming:{row:CategoryRecord;id:string;title:string}[]=[]
    let skipped=0,renamed=0
    // Allocate all new IDs before rewriting references. The workspace lock
    // serializes cloud entity mutations and prevents mapping partial graphs.
    for(const row of archive.records) {
      const key=recordKey(row.kind,row.title,row.content)
      const target=lookup.get(key)?.[0]
      if(target&&strategy==='skip') {
        maps.local.set(row.kind+':'+row.localId,Number(target.local_id))
        maps.uuid.set(row.sourceId,target.id)
        skipped++;continue
      }
      let title=row.title
      if(usedKeys.has(key)) {
        let index=1
        while(index<1000) {
          const suffix=index===1 ? '（导入）' : '（导入'+index+'）'
          title=row.title.slice(0,200-suffix.length)+suffix
          if(!usedKeys.has(recordKey(row.kind,title,row.content)))break
          index++
        }
        if(index===1000)fail('CATEGORY_NAME_CONFLICT')
        renamed++
      }
      usedKeys.add(recordKey(row.kind,title,row.content))
      const inserted=await client.query<{id:string;local_id:string}>(
        "INSERT INTO entities(workspace_id,kind,title,content,created_by,updated_by) "+
        "VALUES($1,$2,$3,'{}'::jsonb,$4,$4) RETURNING id,local_id::text",
        [workspaceId,row.kind,title,actorId])
      const fresh=inserted.rows[0]
      maps.local.set(row.kind+':'+row.localId,Number(fresh.local_id))
      maps.uuid.set(row.sourceId,fresh.id)
      incoming.push({row,id:fresh.id,title})
    }

    // Reuse tags already present in the target; import only missing tag names.
    const oldTags=await client.query<TagRow>(
      'SELECT id,name,color FROM workspace_tags WHERE workspace_id=$1 FOR UPDATE',[workspaceId])
    const byName=new Map(oldTags.rows.map(tag=>[tag.name.trim().toLocaleLowerCase('zh-CN'),tag.id]))
    for(const tag of archive.tags) {
      const key=tag.name.trim().toLocaleLowerCase('zh-CN')
      let id=byName.get(key)
      if(!id) {
        const added=await client.query<{id:string}>(
          "INSERT INTO workspace_tags(workspace_id,name,color,created_by) "+
          "VALUES($1,$2,$3,$4) RETURNING id",
          [workspaceId,tag.name,tag.color,actorId])
        id=added.rows[0].id
        byName.set(key,id)
      }
      maps.tags.set(tag.id,id)
    }

    // Only materialize files actually referenced by newly created records.
    const required=collectArchiveMedia(incoming.map(item=>item.row))
    for(const item of incoming) {
      const references=characterMediaIds(item.row.kind,item.row.content)
      if(references===null)fail('CATEGORY_MEDIA_INVALID')
      for(const id of references)required.add(id.toLowerCase())
    }
    const selectedAssets=archive.assets.filter(asset=>required.has(asset.id))
    if(selectedAssets.length!==required.size)fail('CATEGORY_MEDIA_MISSING')
    let bytes=0
    for(const asset of selectedAssets) {
      const body=new Uint8Array(Buffer.from(asset.base64,'base64'))
      bytes+=body.byteLength
      if(body.byteLength>MAX_UPLOAD_BYTES||bytes>MAX_ARCHIVE_BYTES)fail('CATEGORY_TOO_LARGE')
      const detected=detectAllowedImage(body)
      if(!detected||detected.mime!==asset.mime)fail('CATEGORY_MEDIA_INVALID')
      const saved=await writePrivateImage(workspaceId,body)
      written.push(saved.storageKey)
      const inserted=await client.query<{id:string}>(
        "INSERT INTO media_assets(workspace_id,uploaded_by,storage_key,mime_type,byte_size,content_sha256) "+
        "VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
        [workspaceId,actorId,saved.storageKey,saved.kind.mime,saved.size,saved.sha256])
      maps.media.set(asset.id,inserted.rows[0].id)
    }
    for(const item of incoming) {
      const content=cleanForImport(item.row.kind,item.row.content)
      const adjusted=remapPortableContent(item.row.kind,content,maps)
      const primary=item.row.kind==='character'||item.row.kind==='country'?'name':'title'
      adjusted[primary]=item.title
      const doc=readEntityDocument({title:item.title,data:adjusted})
      if(!doc)fail('CATEGORY_INVALID_ENTITY')
      if(!await characterMediaAllowed(client,workspaceId,item.row.kind,doc.data)||
         !await characterLinksAllowed(client,workspaceId,item.row.kind,doc.data,item.id)||
         item.row.kind==='event'&&!await eventLinksAllowed(client,workspaceId,doc.data,item.id)||
         !await worldLinksAllowed(client,workspaceId,item.row.kind,doc.data,item.id)||
         !await cloudMapAllowed(client,workspaceId,item.row.kind,doc.data,item.title,item.id)||
         !await cloudNovelAllowed(client,workspaceId,item.row.kind,doc.data))
        fail('CATEGORY_REFERENCE_INVALID')
      await client.query(
        "UPDATE entities SET title=$1,content=$2::jsonb,updated_at=now() "+
        "WHERE id=$3 AND workspace_id=$4",
        [item.title,JSON.stringify(doc.data),item.id,workspaceId])
    }
    await client.query(
      "INSERT INTO audit_logs(workspace_id,actor_id,action,target_id,details) "+
      "VALUES($1,$2,'workspace:category:import',$3,$4::jsonb)",
      [workspaceId,actorId,workspaceId,JSON.stringify({
        format:archive.format,sourceName:archive.sourceName,kind:archive.selection.kind,
        added:incoming.length,skipped,renamed,media:selectedAssets.length})])
    await client.query('COMMIT');started=false
    return {added:incoming.length,skipped,renamed,media:selectedAssets.length,
      total:archive.records.length}
  } catch (cause) {
    if(started)await client.query('ROLLBACK').catch(()=>undefined)
    await Promise.all(written.map(key=>removePrivateImage(key).catch(()=>undefined)))
    throw cause
  } finally {client.release()}
}

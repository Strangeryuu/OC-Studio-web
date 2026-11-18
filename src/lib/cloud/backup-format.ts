import { readEntityDocument, isEntityKind } from '@/lib/cloud/entity-input'
import { readWorkspaceCustomization } from '@/lib/cloud/workspace-customization'
import { isUuid } from '@/lib/cloud/backup-id'

export interface PortableEntity {
  kind:string;sourceId:string;localId:number;title:string;
  content:Record<string,unknown>;version:number;deletedAt:string|null;
  history:{version:number;action:'create'|'update'|'restore'|'delete';summary?:string|null;
    createdAt?:string;content:Record<string,unknown>}[]
}
export interface PortableAsset {id:string;mime:string;base64:string}
export interface PortableTag {id:string;name:string;color:string;legacyId?:number}
export interface PortableSetting {key:string;value:unknown}
export interface PortableBackup {
  records:PortableEntity[];assets:PortableAsset[];tags:PortableTag[];settings:PortableSetting[]
  source:'cloud'|'legacy'
}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const kinds=['characters','events','countries','worldEntries'] as const
const mapKind={characters:'character',events:'event',countries:'country',worldEntries:'worldEntry'} as const
const validVersion=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1&&v<=10000
const validId=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0&&v<Number.MAX_SAFE_INTEGER

/** Accepts the original v1 .ocbak, with an optional complete cloud sidecar. */
export function parsePortableBackup(raw:unknown):PortableBackup|null{
  if(!obj(raw)||raw.version!==1||!obj(raw.data))return null
  const cloud=obj(raw.cloud)&&raw.cloud.format==='oc-studio-web-v1'?raw.cloud:null
  const records:PortableEntity[]=[]
  if(cloud){
    if(!Array.isArray(cloud.records)||cloud.records.length>3000||
      !Array.isArray(cloud.assets)||cloud.assets.length>500||
      !Array.isArray(cloud.tags)||cloud.tags.length>1000||
      !Array.isArray(cloud.settings)||cloud.settings.length>20)return null
    for(const value of cloud.records){
      if(!obj(value)||!isUuid(value.id)||!validId(value.localId)||
        !isEntityKind(value.kind)||!obj(value.content)||
        !validVersion(value.version)||!Array.isArray(value.history)||value.history.length>10000||
        !(value.deletedAt===null||typeof value.deletedAt==='string'&&!Number.isNaN(Date.parse(value.deletedAt))))return null
      const document=readEntityDocument({title:value.title,data:value.content})
      if(!document)return null
      const history:PortableEntity['history']=[]
      for(const item of value.history){
        if(!obj(item)||!validVersion(item.version)||!['create','update','restore','delete'].includes(String(item.action))||
          !obj(item.content)||!readEntityDocument(item.content))return null
        history.push({version:item.version,action:item.action as PortableEntity['history'][number]['action'],
          summary:typeof item.summary==='string'?item.summary:null,
          createdAt:typeof item.createdAt==='string'?item.createdAt:undefined,
          content:item.content})
      }
      if(history.length&&(
        history.length!==value.version||history.some((h,i)=>h.version!==i+1)))return null
      records.push({kind:value.kind,sourceId:value.id,localId:value.localId,title:document.title,
        content:document.data as Record<string,unknown>,version:value.version,
        deletedAt:value.deletedAt,history})
    }
    const assets:PortableAsset[]=[]
    for(const value of cloud.assets){
      if(!obj(value)||!isUuid(value.id)||typeof value.mime!=='string'||
        !['image/png','image/jpeg','image/gif','image/webp'].includes(value.mime)||
        typeof value.base64!=='string'||value.base64.length>12000000||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64))return null
      assets.push({id:value.id,mime:value.mime,base64:value.base64})
    }
    const tags:PortableTag[]=[]
    for(const value of cloud.tags){
      if(!obj(value)||!isUuid(value.id)||typeof value.name!=='string'||value.name.trim().length<1||
        value.name.length>40||typeof value.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(value.color))return null
      tags.push({id:value.id,name:value.name,color:value.color})
    }
    const settings:PortableSetting[]=[]
    for(const value of cloud.settings){
      if(!obj(value)||!['customization','world-cover','character-config'].includes(String(value.key)))return null
      if(value.key==='customization'&&!readWorkspaceCustomization(value.value))return null
      settings.push({key:value.key as string,value:value.value})
    }
    if(new Set(records.map(r=>r.sourceId)).size!==records.length||
      new Set(records.map(r=>r.kind+':'+r.localId)).size!==records.length||
      new Set(assets.map(a=>a.id)).size!==assets.length||
      new Set(tags.map(t=>t.id)).size!==tags.length||
      new Set(settings.map(t=>t.key)).size!==settings.length)return null
    return {records,assets,tags,settings,source:'cloud'}
  }
  // Original desktop JSON archives have per-table numeric IDs and inline images.
  for(const collection of kinds){
    const values=raw.data[collection]
    if(!Array.isArray(values)||values.length>3000)return null
    for(const row of values){
      if(!obj(row)||!validId(row.id)||row.deleted===true)continue
      const kind=mapKind[collection]
      const content={...row}
      delete content.id
      const title=kind==='character'||kind==='country'?row.name:row.title
      const doc=readEntityDocument({title,data:content})
      if(!doc)return null
      records.push({kind,sourceId:kind+':'+row.id,localId:row.id,title:doc.title,
        content:doc.data as Record<string,unknown>,version:1,deletedAt:null,history:[]})
    }
  }
  if(records.length>3000||new Set(records.map(r=>r.sourceId)).size!==records.length)return null
  const tags:PortableTag[]=[]
  if(Array.isArray(raw.data.tags)){
    for(const tag of raw.data.tags.slice(0,500)){
      if(obj(tag)&&validId(tag.id)&&typeof tag.name==='string'&&tag.name.trim()&&tag.name.length<=40){
        tags.push({id:'legacy-tag:'+tag.id,name:tag.name,
          color:typeof tag.color==='string'&&/^#[0-9a-fA-F]{6}$/.test(tag.color)?tag.color:('#' + '64748b'),
          legacyId:tag.id})
      }
    }
  }
  const settings:PortableSetting[]=[]
  if(obj(raw.config)&&Array.isArray(raw.config.categories)&&Array.isArray(raw.config.templates)){
    const normalized=readWorkspaceCustomization({
      categories:raw.config.categories,templates:raw.config.templates,
    })
    if(normalized)settings.push({key:'customization',value:normalized})
  }
  return {records,assets:[],tags,settings,source:'legacy'}
}

export type ImportIdMaps = {
  local: Map<string,number>
  uuid: Map<string,string>
  media: Map<string,string>
  tags: Map<string,string>
}
/** Map old IDs into fresh target identities. Never preserve source workspace IDs. */
export function remapPortableContent(kind:string,content:Record<string,unknown>,maps:ImportIdMaps):Record<string,unknown>{
  const local=(type:string,id:unknown)=>typeof id==='number'?
    (maps.local.get(type+':'+id)??id):id
  const replace=(value:unknown,key:string,parent:string):unknown=>{
    if(typeof value==='string'){
      const mediaUrl=/^\/api\/media\/([a-fA-F0-9-]{36})$/.exec(value)
      if(mediaUrl){
        const next=maps.media.get(mediaUrl[1].toLowerCase())
        if(!next)throw new Error('BACKUP_MEDIA_MISSING')
        return '/api/media/'+next
      }
      return maps.uuid.get(value)??maps.media.get(value)??maps.tags.get(value)??value
    }
    if(Array.isArray(value)){
      if(key==='characters'&&kind==='event')return value.map(id=>local('character',id))
      if(key==='countries'&&kind==='event')return value.map(id=>local('country',id))
      return value.map(item=>replace(item,'',key))
    }
    if(value&&typeof value==='object'){
      const output:Record<string,unknown>={}
      const obj=value as Record<string,unknown>
      for(const [name,item] of Object.entries(obj)){
        if(name==='countryId')output[name]=local('country',item)
        else if(name==='parentEventId')output[name]=local('event',item)
        else if(name==='parentId')output[name]=local(kind==='country'?'country':'worldEntry',item)
        else if(name==='characterId')output[name]=local('character',item)
        else if(name==='targetId')output[name]=local(
          parent==='relatedCharacters'?'character':parent==='relatedNotes'?'worldEntry':
          kind==='event'?'event':'worldEntry',item)
        else output[name]=replace(item,name,key)
      }
      return output
    }
    return value
  }
  return replace(content,'','') as Record<string,unknown>
}

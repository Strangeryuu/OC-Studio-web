/**
 * Convert the OC-editor OCAV v1 export format to the server's incremental,
 * workspace-scoped category protocol. OC-editor is an MIT-licensed project:
 * https://github.com/nekibud/OC-editor/blob/main/src/lib/ocav.ts
 *
 * The parser is purpose-built for this integration and does not use Dexie.
 * The original OC Studio v1 backup parser stays completely independent.
 */
import {
  CATEGORY_FORMAT, parseCategoryArchive,
  type CategoryArchive, type CategoryKind, type CategoryRecord,
  type CategoryExternalRef,
} from '@/lib/cloud/category-archive'

type Row = Record<string,unknown>
const isRow=(x:unknown):x is Row=>x!==null&&typeof x==='object'&&!Array.isArray(x)
const numeric=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>0&&x<2**48
const validName=(x:unknown):x is string=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=200
function throwCode(code:string):never { throw new Error(code) }
const types:Record<string,CategoryKind>={
  characters:'character',events:'event',countries:'country',worldEntries:'worldEntry',
}
const hints:Record<string,string>={
  character:'characters',event:'events',country:'countries',
  'world-entry':'worldEntries','custom-section':'customSections',
}
const kindCode:Record<CategoryKind,number>={character:1,event:2,country:3,worldEntry:4}
/** Synthetic source identities are not reused in the destination database. */
function syntheticUuid(type:number,id:number):string {
  if(!numeric(id))throwCode('OC_EDITOR_BAD_ID')
  return '9100000'+type+'-0000-4000-8000-'+id.toString(16).padStart(12,'0')
}
function rows(value:unknown):Row[] {
  if(value===undefined||value===null)return []
  if(!Array.isArray(value)||value.length>500||value.some(x=>!isRow(x)))
    throwCode('OC_EDITOR_INVALID')
  return value as Row[]
}
function numbers(value:unknown):number[] {
  if(value===undefined||value===null)return []
  if(!Array.isArray(value)||value.length>1000||value.some(x=>!numeric(x)))
    throwCode('OC_EDITOR_BAD_REFERENCE')
  return value as number[]
}
function shape(value:Row):string|null {
  if(typeof value.name==='string'&&Array.isArray(value.entries))return 'customSections'
  if(typeof value.title==='string'){
    if(typeof value.time==='string'||typeof value.summary==='string'||
      typeof value.location==='string'||typeof value.isMajor==='boolean'||
      Array.isArray(value.characters)||Array.isArray(value.countries)||
      Array.isArray(value.relations)||value.parentEventId!==undefined)return 'events'
    if(typeof value.category==='string'||typeof value.isConcept==='boolean'||
      Array.isArray(value.references)||typeof value.order==='number')return 'worldEntries'
    return null
  }
  if(typeof value.name==='string'){
    if(typeof value.system==='string'||typeof value.geography==='string'||
       typeof value.culture==='string'||typeof value.flagUrl==='string'||
       Array.isArray(value.characters)||Array.isArray(value.events))return 'countries'
    if(typeof value.avatarUrl==='string'||typeof value.bio==='string'||
       typeof value.entityKind==='string'||Array.isArray(value.aliases)||
       Array.isArray(value.relatedCharacters)||typeof value.lifeStory==='string')return 'characters'
  }
  return null
}
function resolveTable(items:Row[], table:unknown, kind:unknown):string {
  const obvious=new Set(items.map(shape).filter(Boolean))
  if(obvious.size>1)throwCode('OC_EDITOR_MIXED_KINDS')
  const detected=[...obvious][0]
  const declared=typeof table==='string'&&
    (Object.hasOwn(types,table)||table==='customSections')?table:null
  const hinted=typeof kind==='string'&&hints[kind]?hints[kind]:null
  const chosen=detected??declared??hinted
  if(!chosen)throwCode('OC_EDITOR_UNRECOGNIZED_KIND')
  const expected=chosen==='customSections'?'name':chosen==='events'||chosen==='worldEntries'?'title':'name'
  if(items.some(item=>!validName(item[expected])))throwCode('OC_EDITOR_MIXED_KINDS')
  return chosen
}
export function isOcEditorCategory(value:unknown):boolean {
  return isRow(value)&&value.format==='oc-editor-ocav'
}
/** Recognizes a real OC-editor archive, or returns null for unrelated formats. */
export function convertOcEditorCategory(value:unknown):CategoryArchive|null {
  if(!isOcEditorCategory(value))return null
  const raw=value as Row
  const payload=raw.payload
  if(raw.version!==1||!isRow(payload)||!Array.isArray(payload.items))
    throwCode('OC_EDITOR_INVALID')
  const items=rows(payload.items)
  if(items.length===0)throwCode('OC_EDITOR_EMPTY')
  const table=resolveTable(items,payload.table,raw.kind)
  const context=isRow(payload.context)?payload.context:{}
  const contextMode=payload.contextMode==='link-only'?'link-only':'create'
  const sections=table==='customSections'
  const primaryKind:CategoryKind=sections?'worldEntry':types[table]
  if(!primaryKind)throwCode('OC_EDITOR_UNRECOGNIZED_KIND')
  const labels=isRow(raw.world)&&validName(raw.world.name)?raw.world.name:
    'OC editor'
  const sourceName=labels.slice(0,200)
  const sourceDate=typeof raw.exportedAt==='string'&&!Number.isNaN(Date.parse(raw.exportedAt))
    ?raw.exportedAt:new Date().toISOString()
  const folderNames=new Map<string,string>()
  for(const folder of rows(payload.folders)){
    if(typeof folder.id!=='string'||!validName(folder.name)||folder.name.length>60)
      throwCode('OC_EDITOR_INVALID_FOLDER')
    folderNames.set(folder.id,folder.name)
  }

  const assets:CategoryArchive['assets']=[]
  const mediaSeen=new Map<string,string>()
  const transferMedia=(x:unknown,depth=0):unknown=>{
    if(depth>30)throwCode('OC_EDITOR_TOO_DEEP')
    if(typeof x==='string'){
      if(!x.startsWith('data:image/'))return x
      const match=/^data:image\/(png|jpeg|gif|webp);base64,([a-zA-Z0-9+/]*={0,2})$/i.exec(x)
      if(!match)throwCode('OC_EDITOR_IMAGE_FORMAT')
      const cached=mediaSeen.get(x)
      if(cached)return cached
      if(assets.length>=100||match[2].length>12000000)throwCode('OC_EDITOR_TOO_LARGE')
      const id=syntheticUuid(8,assets.length+1)
      assets.push({id,mime:'image/'+match[1].toLowerCase(),base64:match[2]})
      const url='/api/media/'+id
      mediaSeen.set(x,url)
      return url
    }
    if(Array.isArray(x))return x.map(item=>transferMedia(item,depth+1))
    if(isRow(x)){
      const result:Row={}
      for(const [key,item] of Object.entries(x))result[key]=transferMedia(item,depth+1)
      return result
    }
    return x
  }

  const tagIds=new Map<number,string>()
  const tags:CategoryArchive['tags']=[]
  for(const tag of rows(context.tags)){
    if(!numeric(tag.id)||!validName(tag.name)||tag.name.length>40||
        tagIds.has(tag.id))throwCode('OC_EDITOR_INVALID_TAG')
    const id=syntheticUuid(7,tag.id)
    tagIds.set(tag.id,id)
    tags.push({id,name:tag.name,color:typeof tag.color==='string'&&
      /^#[0-9a-f]{6}$/i.test(tag.color)?tag.color:('#'+'64748b')})
  }

  const normalized:CategoryRecord[]=[]
  const seen=new Set<string>()
  const known=new Map<string,CategoryRecord>()
  const externalRefs:CategoryExternalRef[]=[]
  const existingRefKeys=new Set<string>()
  // Defer content conversion until all primary/context row identities are known.
  const create=(kind:CategoryKind,source:Row):void=>{
    if(!numeric(source.id))throwCode('OC_EDITOR_BAD_ID')
    const key=kind+':'+source.id
    if(seen.has(key))throwCode('OC_EDITOR_DUPLICATE_ID')
    seen.add(key)
    const title=kind==='character'||kind==='country'?source.name:source.title
    if(!validName(title))throwCode('OC_EDITOR_MIXED_KINDS')
    const content:Row={...source}
    for(const field of ['id','worldId','deleted','_syncStatus','_lastModified']){
      delete content[field]
    }
    if(kind==='character'&&typeof content.folderId==='string'){
      const folder=folderNames.get(content.folderId)
      if(folder)content.folder=folder
    }
    if(content.tags!==undefined) {
      const values=numbers(content.tags)
      if(values.some(id=>!tagIds.has(id)))throwCode('OC_EDITOR_INVALID_TAG')
      content.cloudTagIds=[...new Set(values.map(id=>tagIds.get(id)!))]
      content.tags=[]
    }
    if(kind==='worldEntry') {
      if(content.category===undefined)content.category='concept'
      if(typeof content.category!=='string'||content.category.length>100)
        throwCode('OC_EDITOR_INVALID_CATEGORY')
    }
    // Legacy JSON can hold a TipTap document as JSON text; restore the JSON
    // tree so nested images and mention nodes are parsed and remapped.
    if(typeof content.document==='string'&&content.document.trim().startsWith('{')){
      try {
        const parsed=JSON.parse(content.document) as unknown
        if(isRow(parsed)&&parsed.type==='doc')content.document=parsed
      } catch {throwCode('OC_EDITOR_INVALID_DOCUMENT')}
    }
    const replaced=transferMedia(content) as Row
    const entry:CategoryRecord={
      sourceId:syntheticUuid(kindCode[kind],source.id),
      localId:source.id,kind,title:title.trim(),content:replaced,
    }
    normalized.push(entry);known.set(key,entry)
  }
  let sectionName:string|undefined
  let sectionRaw:Row|null=null
  if(sections){
    if(items.length!==1||!validName(items[0].name))throwCode('OC_EDITOR_INVALID_SECTION')
    sectionRaw=items[0];sectionName=items[0].name.trim()
    if(sectionName==='地图'||sectionName==='小说')throwCode('OC_EDITOR_INVALID_CATEGORY')
    const sectionEntries=rows(sectionRaw.entries)
    if(sectionEntries.length===0)throwCode('OC_EDITOR_EMPTY')
    let index=0
    for(const entry of sectionEntries){
      const name=entry.name
      if(!validName(name)||typeof entry.id!=='string'||!entry.id||
          entry.id.length>150)throwCode('OC_EDITOR_INVALID_SECTION')
      index++
      const original={
        title:name,category:sectionName,
        content:typeof entry.note==='string'?entry.note:'',
        cover:entry.headerUrl??'',avatar:entry.avatarUrl??'',gallery:entry.gallery??[],
        ocEditorSection:{
          sectionId:typeof sectionRaw.id==='string'?sectionRaw.id:'',
          entryId:entry.id,description:sectionRaw.description??'',
          accentColor:sectionRaw.accentColor??'',
          links:{
            characterLinks:entry.characterLinks??{},countryLinks:entry.countryLinks??{},
            eventLinks:entry.eventLinks??{},entryLinks:entry.entryLinks??{},
          },
        },
      }
      create('worldEntry',{id:index,...original})
    }
  }else {
    const kind=types[table]
    for(const item of items){
      if(shape(item)!==null&&shape(item)!==table)throwCode('OC_EDITOR_MIXED_KINDS')
      create(kind,item)
    }
    if(contextMode==='create') {
      for(const [key,kind] of Object.entries(types)){
        for(const item of rows(context[key])){
          if(shape(item)!==null&&shape(item)!==key)throwCode('OC_EDITOR_MIXED_KINDS')
          if(!seen.has(kind+':'+item.id))create(kind,item)
        }
      }
    }else if(Object.keys(context).some(k=>k!=='tags'&&rows(context[k]).length>0)){
      // Link-only files must not surprise users by creating context entities.
      throwCode('OC_EDITOR_INVALID_CONTEXT')
    }
  }

  // Custom-section entries have string IDs. Rewrite their scoped edges and
  // entryLinks into the Web's ordinary worldEntry relation projections.
  if(sectionRaw){
    const sectionEntries=rows(sectionRaw.entries)
    const indexById=new Map<string,number>()
    sectionEntries.forEach((row,i)=>{
      if(indexById.has(String(row.id)))throwCode('OC_EDITOR_DUPLICATE_ID')
      indexById.set(String(row.id),i+1)
    })
    const append=(from:unknown,to:unknown,label:unknown)=>{
      const sourceId=indexById.get(String(from))
      const targetId=indexById.get(String(to))
      if(!sourceId||!targetId||sourceId===targetId)throwCode('OC_EDITOR_BAD_REFERENCE')
      const row=known.get('worldEntry:'+sourceId)!
      const data=row.content
      const list=Array.isArray(data.relations)?data.relations as Row[]:[]
      const text=typeof label==='string'&&label.trim()?label.trim():'相关'
      if(!list.some(item=>item.targetId===targetId&&item.relation===text))
        list.push({targetId,relation:text,name:sectionEntries[targetId-1].name})
      data.relations=list
    }
    for(const edge of rows(sectionRaw.scopedEdges)){
      append(edge.source,edge.target,edge.label)
    }
    for(const entry of sectionEntries){
      for(const targetId of Array.isArray(entry.relatedEntryIds)?entry.relatedEntryIds:[]){
        const link=isRow(entry.entryLinks)?entry.entryLinks[String(targetId)]:undefined
        append(entry.id,targetId,isRow(link)?link.relation:undefined)
      }
    }
    // Cross-entity links from custom entries keep a typed name-only ref.
    for(let i=0;i<sectionEntries.length;i++){
      const entry=sectionEntries[i]
      const result=known.get('worldEntry:'+(i+1))!
      const references:Row[]=[]
      for(const [field,refType] of [
        ['characterIds','character'],['countryIds','country'],
        ['eventIds','event'],['worldEntryIds','worldEntry'],
      ] as const){
        for(const id of numbers(entry[field])){
          const key=refType+':'+id
          references.push({targetType:refType==='worldEntry'?'world':refType,targetId:id})
          if(!known.has(key)&&!existingRefKeys.has(key))existingRefKeys.add(key)
        }
      }
      result.content.references=references
    }
  }

  const refs=rows(payload.refs)
  for(const ref of refs){
    const kind=ref.type==='world'?'worldEntry':ref.type
    if(typeof kind!=='string'||!Object.values(types).includes(kind as CategoryKind)||
        !numeric(ref.id)||!validName(ref.name))throwCode('OC_EDITOR_INVALID_REF')
    const key=kind+':'+ref.id
    if(known.has(key))continue
    if(existingRefKeys.has(key))existingRefKeys.delete(key)
    externalRefs.push({kind:kind as CategoryKind,localId:ref.id,name:ref.name.trim()})
    existingRefKeys.add(key)
  }
  // Ensure all cross-entity references have enough information for explicit
  // name resolution, rather than preserving dangling numeric IDs.
  if(sectionRaw){
    for(const item of normalized){
      for(const ref of Array.isArray(item.content.references)?item.content.references:[]){
        if(!isRow(ref))throwCode('OC_EDITOR_BAD_REFERENCE')
        const k=ref.targetType==='world'?'worldEntry':ref.targetType
        const key=k+':'+ref.targetId
        if(!known.has(key)&&!externalRefs.some(r=>r.kind===k&&r.localId===ref.targetId))
          throwCode('OC_EDITOR_REF_NAME_MISSING')
      }
    }
  }

  // Standalone relations are a separate OC-editor store. Project supported
  // edges into the original Web's authoritative entity fields exactly once.
  const relations=rows(raw.relations)
  for(const edge of relations){
    const sourceKind=edge.sourceType, targetKind=edge.targetType
    if(typeof sourceKind!=='string'||typeof targetKind!=='string'||
        !Object.values(types).includes(sourceKind as CategoryKind)||
        !Object.values(types).includes(targetKind as CategoryKind)||
        !numeric(edge.sourceId)||!numeric(edge.targetId))
      throwCode('OC_EDITOR_INVALID_RELATION')
    const from=known.get(sourceKind+':'+edge.sourceId)
    const to=known.get(targetKind+':'+edge.targetId)
    if(!from&&!to)throwCode('OC_EDITOR_RELATION_MISSING')
    const label=typeof edge.label==='string'&&edge.label.trim()?edge.label.trim():'相关'
    const style={color:typeof edge.color==='string'?edge.color:undefined,
      arrow:edge.arrow==='none'||edge.arrow==='forward'||
        edge.arrow==='reverse'||edge.arrow==='both'?edge.arrow:undefined}
    const push=(row:CategoryRecord,key:string,idKey:string,target:number)=>{
      const list=Array.isArray(row.content[key])?[...row.content[key] as Row[]]:[]
      if(!list.some(x=>x[idKey]===target&&x.relation===label)){
        list.push({[idKey]:target,relation:label,...style})
      }
      row.content[key]=list
    }
    const pair=sourceKind+':'+targetKind
    const reverse=targetKind+':'+sourceKind
    if(pair==='character:character'){
      if(from)push(from,'relatedCharacters','characterId',edge.targetId)
      else if(to)push(to,'relatedCharacters','characterId',edge.sourceId)
    }else if(pair==='event:event'){
      if(from)push(from,'relations','targetId',edge.targetId)
      else if(to)push(to,'relations','targetId',edge.sourceId)
    }else if(pair==='country:country'){
      if(from){
        const old=numbers(from.content.relatedNations)
        from.content.relatedNations=[...new Set([...old,edge.targetId])]
      } else if(to){
        const old=numbers(to.content.relatedNations)
        to.content.relatedNations=[...new Set([...old,edge.sourceId])]
      }
    }else if(pair==='character:country'||reverse==='character:country'){
      const character=sourceKind==='character'?from:to
      const countryId=sourceKind==='country'?edge.sourceId:edge.targetId
      if(character&&character.content.countryId==null)character.content.countryId=countryId
      else if(character&&character.content.countryId!==countryId)
        character.content.relatedNations=[...new Set([...numbers(character.content.relatedNations),countryId])]
    }else if(pair==='event:character'||reverse==='event:character'){
      const event=sourceKind==='event'?from:to
      const characterId=sourceKind==='character'?edge.sourceId:edge.targetId
      if(event)event.content.characters=[...new Set([...numbers(event.content.characters),characterId])]
    }else if(pair==='event:country'||reverse==='event:country'){
      const event=sourceKind==='event'?from:to
      const countryId=sourceKind==='country'?edge.sourceId:edge.targetId
      if(event)event.content.countries=[...new Set([...numbers(event.content.countries),countryId])]
    }else throwCode('OC_EDITOR_UNSUPPORTED_RELATION')
  }

  let selection:CategoryArchive['selection']
  if(sectionName)selection={kind:'worldEntry',category:sectionName}
  else selection={kind:primaryKind}
  const converted:CategoryArchive={
    format:CATEGORY_FORMAT,version:1,sourceName,exportedAt:sourceDate,
    selection,records:normalized,assets,tags,externalRefs,
    primarySourceIds:sections?normalized.map(row=>row.sourceId):items.map(item=>{
      if(!numeric(item.id))throwCode('OC_EDITOR_BAD_ID')
      return syntheticUuid(kindCode[primaryKind],item.id)
    }),
    sourceFormat:'oc-editor-ocav',nativeRelations:relations.length,
  }
  if(!parseCategoryArchive(converted))throwCode('OC_EDITOR_INVALID')
  return converted
}

export function detectArchiveType(value:unknown):
  'oc-editor'|'web-category'|'oc-studio-full'|'unknown' {
  if(isRow(value)&&value.format==='oc-editor-ocav')return 'oc-editor'
  if(isRow(value)&&value.format===CATEGORY_FORMAT)return 'web-category'
  if(isRow(value)&&value.version===1&&isRow(value.data))return 'oc-studio-full'
  return 'unknown'
}

/** Apply strict parsing after native conversion, never bypassing validation. */
export function parseSupportedCategory(value:unknown):CategoryArchive|null {
  const converted=convertOcEditorCategory(value)
  return converted??parseCategoryArchive(value)
}

/**
 * Selective OC Studio Web archives. Inspired by OC-editor's OCAV user flow,
 * implemented separately for PostgreSQL and workspace-scoped cloud identities.
 *
 * Files are JSON with .ocbak extension. Full-library restore keeps its own v1
 * protocol; this parser deliberately rejects full backups.
 */
import { readEntityDocument } from '@/lib/cloud/entity-input'
import { isUuid } from '@/lib/cloud/backup-id'

export const CATEGORY_FORMAT = 'oc-studio-web-category-v1'
export type CategoryKind = 'character' | 'event' | 'country' | 'worldEntry'
export type CategoryStrategy = 'skip' | 'keep-both'
export interface CategorySelection {
  kind: CategoryKind
  folder?: string
  category?: string
}
export interface CategoryRecord {
  sourceId: string
  localId: number
  kind: CategoryKind
  title: string
  content: Record<string, unknown>
}
export interface CategoryAsset { id: string; mime: string; base64: string }
export interface CategoryTag { id: string; name: string; color: string }
export interface CategoryExternalRef {kind: CategoryKind; localId: number; name: string}
export interface CategoryArchive {
  format: typeof CATEGORY_FORMAT
  version: 1
  sourceName: string
  exportedAt: string
  selection: CategorySelection
  records: CategoryRecord[]
  assets: CategoryAsset[]
  tags: CategoryTag[]
  /** OC-editor link-only references are resolved by kind and name in the target workspace. */
  externalRefs?: CategoryExternalRef[]
  sourceFormat?: 'oc-editor-ocav'
  nativeRelations?: number
}
const kinds = new Set<CategoryKind>(['character','event','country','worldEntry'])
const imageMimes = new Set(['image/png','image/jpeg','image/gif','image/webp'])
const obj = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const goodId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export function readCategorySelection(input: unknown): CategorySelection | null {
  if (!obj(input) || !kinds.has(input.kind as CategoryKind)) return null
  const kind = input.kind as CategoryKind
  const folder = input.folder
  const category = input.category
  if (folder !== undefined && (kind !== 'character' || typeof folder !== 'string' || folder.length > 100)) return null
  if (category !== undefined && (kind !== 'worldEntry' || typeof category !== 'string' || category.length > 100)) return null
  return {kind, ...(folder === undefined ? {} : {folder: folder as string}),
    ...(category === undefined ? {} : {category: category as string})}
}

/** Images in exported cloud archives must be private assets, never external URLs. */
export function categoryMediaLinksSafe(data:Record<string,unknown>):boolean {
  const slots=new Set([
    'avatarUrl','headerUrl','flagUrl','cover','avatar','image','mapImage',
    'novelCover','coverUrl','animationUrl',
  ])
  const allowed=(value:unknown):boolean=>
    value===null||value===undefined||value===''||
    (typeof value==='string' && /^\/api\/media\//.test(value) &&
     isUuid(value.slice('/api/media/'.length)))
  const walk=(value:unknown,parent:string,depth:number,inImageNode=false):boolean=>{
    if(depth>35)return false
    if(Array.isArray(value))return value.every(x=>walk(x,parent,depth+1,inImageNode))
    if(typeof value==='string'&&['document','content'].includes(parent)&&value.trim().startsWith('{')) {
      try {const parsed=JSON.parse(value) as unknown
        if(obj(parsed)&&parsed.type==='doc')return walk(parsed,parent,depth+1,inImageNode)
      } catch {return true}
    }
    if(!obj(value))return true
    const imageNode=inImageNode||value.type==='imageBlock'||value.type==='image'
    for(const [key,item] of Object.entries(value)) {
      const imageSource=slots.has(key)||
        (key==='url'&&['gallery','avatars','images'].includes(parent))||
        (key==='src'&&imageNode)
      if(imageSource && !allowed(item))return false
      if(!walk(item,key,depth+1,imageNode))return false
    }
    return true
  }
  return walk(data,'',0)
}

export function parseCategoryArchive(input: unknown): CategoryArchive | null {
  if (!obj(input) || input.format !== CATEGORY_FORMAT || input.version !== 1 ||
      typeof input.sourceName !== 'string' || input.sourceName.length > 200 ||
      typeof input.exportedAt !== 'string' || Number.isNaN(Date.parse(input.exportedAt)) ||
      !Array.isArray(input.records) || input.records.length < 1 || input.records.length > 500 ||
      !Array.isArray(input.assets) || input.assets.length > 100 ||
      !Array.isArray(input.tags) || input.tags.length > 500) return null
  const selection = readCategorySelection(input.selection)
  if (!selection) return null
  const records: CategoryRecord[] = []
  const seen = new Set<string>(), ids = new Set<string>()
  for (const row of input.records) {
    if (!obj(row) || !kinds.has(row.kind as CategoryKind) ||
        (row.kind==='worldEntry' && obj(row.content) && ['小说','地图'].includes(String(row.content.category??''))) ||
        !isUuid(row.sourceId) || !goodId(row.localId) ||
        !obj(row.content) || typeof row.title !== 'string') return null
    if(!categoryMediaLinksSafe(row.content))return null
    const doc = readEntityDocument({title:row.title,data:row.content})
    if (!doc) return null
    const key = row.kind + ':' + row.localId
    if (seen.has(key) || ids.has(row.sourceId.toLowerCase())) return null
    seen.add(key); ids.add(row.sourceId.toLowerCase())
    records.push({kind:row.kind as CategoryKind, sourceId:row.sourceId.toLowerCase(),
      localId:row.localId, title:doc.title,content:doc.data as Record<string,unknown>})
  }
  const assets: CategoryAsset[] = [], assetIds = new Set<string>()
  let encodedSize = 0
  for (const asset of input.assets) {
    if (!obj(asset) || !isUuid(asset.id) || typeof asset.mime !== 'string' ||
        !imageMimes.has(asset.mime) || typeof asset.base64 !== 'string' ||
        asset.base64.length > 12000000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64) ||
        assetIds.has(asset.id.toLowerCase())) return null
    encodedSize += asset.base64.length
    if (encodedSize > 40_000_000) return null
    assetIds.add(asset.id.toLowerCase())
    assets.push({id:asset.id.toLowerCase(),mime:asset.mime,base64:asset.base64})
  }
  const tags: CategoryTag[] = [], tagIds = new Set<string>()
  for (const tag of input.tags) {
    if (!obj(tag) || !isUuid(tag.id) || typeof tag.name !== 'string' ||
        !tag.name.trim() || tag.name.length > 40 || typeof tag.color !== 'string' ||
        !/^#[a-f0-9]{6}$/i.test(tag.color) || tagIds.has(tag.id.toLowerCase())) return null
    tagIds.add(tag.id.toLowerCase())
    tags.push({id:tag.id.toLowerCase(),name:tag.name.trim(),color:tag.color})
  }
  if (!selectCategoryRecords(records,selection).length) return null
  if(input.sourceFormat!==undefined&&input.sourceFormat!=='oc-editor-ocav')return null
  if(input.nativeRelations!==undefined&&(!Number.isSafeInteger(input.nativeRelations)||
      (input.nativeRelations as number)<0||(input.nativeRelations as number)>1000))return null
  const externalRefs:CategoryExternalRef[]=[]
  const seenRefs=new Set<string>()
  if(input.externalRefs!==undefined){
    if(!Array.isArray(input.externalRefs)||input.externalRefs.length>500)return null
    for(const ref of input.externalRefs){
      if(!obj(ref)||!kinds.has(ref.kind as CategoryKind)||!goodId(ref.localId)||
          typeof ref.name!=='string'||!ref.name.trim()||ref.name.length>200)return null
      const key=ref.kind+':'+ref.localId
      if(seenRefs.has(key)||seen.has(key))return null
      seenRefs.add(key)
      externalRefs.push({kind:ref.kind as CategoryKind,localId:ref.localId,name:ref.name.trim()})
    }
  }
  return {format:CATEGORY_FORMAT,version:1,sourceName:input.sourceName,
    exportedAt:input.exportedAt,selection,records,assets,tags,
    ...(input.sourceFormat===undefined?{}:{sourceFormat:'oc-editor-ocav'}),
    ...(input.nativeRelations===undefined?{}:{nativeRelations:input.nativeRelations as number}),
    ...(input.externalRefs===undefined?{}:{externalRefs})}
}

export function recordKey(kind: CategoryKind, title: string, content: Record<string,unknown>): string {
  const category = kind === 'worldEntry' && typeof content.category === 'string'
    ? content.category.trim().toLocaleLowerCase('zh-CN') : ''
  return kind + ':' + category + ':' + title.trim().toLocaleLowerCase('zh-CN')
}

export function selectCategoryRecords<T extends {kind: CategoryKind; content: Record<string,unknown>}>(
  rows: T[], selection: CategorySelection,
): T[] {
  return rows.filter(row=>{
    if (row.kind !== selection.kind) return false
    if (selection.folder !== undefined && row.content.folder !== selection.folder) return false
    if (selection.category !== undefined && row.content.category !== selection.category) return false
    return true
  })
}

export interface Dependency {kind:CategoryKind; localId?:number; uuid?:string}

/** Rewrite numeric TipTap mention / wikiLink IDs without touching ordinary text. */
function mapDocRefs(value:unknown, replace:(kind:CategoryKind,id:number)=>number):unknown {
  const isJson=typeof value==='string'&&value.trim().startsWith('{')
  let source:unknown=value
  if(isJson) {
    try {source=JSON.parse(value as string) as unknown}
    catch {return value}
  }
  if(!obj(source)||source.type!=='doc')return value
  const walk=(node:unknown,depth:number):unknown=>{
    if(depth>35)throw new Error('CATEGORY_TOO_DEEP')
    if(Array.isArray(node))return node.map(item=>walk(item,depth+1))
    if(!obj(node))return node
    const output={...node}
    if((node.type==='mention'||node.type==='wikiLink')&&obj(node.attrs)) {
      const target=node.type==='wikiLink'?'worldEntry':
        node.attrs.entityType==='world'?'worldEntry':node.attrs.entityType
      if(kinds.has(target as CategoryKind)&&node.attrs.id!==undefined&&node.attrs.id!==null) {
        const id=Number(node.attrs.id)
        if(!goodId(id))throw new Error('CATEGORY_REFERENCE_INVALID')
        output.attrs={...node.attrs,id:String(replace(target as CategoryKind,id))}
      }
    }
    if(Array.isArray(node.content))output.content=node.content.map(child=>walk(child,depth+1))
    return output
  }
  const result=walk(source,0)
  return isJson?JSON.stringify(result):result
}
export function documentDependencies(data:Record<string,unknown>):Dependency[] {
  const refs:Dependency[]=[]
  const track=(kind:CategoryKind,id:number):number=>{
    refs.push({kind,localId:id});return id
  }
  mapDocRefs(data.document,track)
  mapDocRefs(data.content,track)
  return refs
}
export function remapCategoryDocumentRefs(
  data:Record<string,unknown>, maps:ReadonlyMap<string,number>,
):Record<string,unknown> {
  const replace=(kind:CategoryKind,id:number):number=>{
    const mapped=maps.get(kind+':'+id)
    if(mapped===undefined)throw new Error('CATEGORY_REFERENCE_MISSING')
    return mapped
  }
  return {...data,document:mapDocRefs(data.document,replace),
    ...(data.content===undefined?{}:{content:mapDocRefs(data.content,replace)})}
}
/** Numeric original relationships and UUID cloud relationships; no arbitrary JSON ID rewriting. */
export function entityDependencies(row: Pick<CategoryRecord,'kind'|'content'>): Dependency[] {
  const c = row.content, refs:Dependency[] = []
  const add = (kind:CategoryKind, id:unknown) => {
    if (id === undefined || id === null || id === '') return
    if (!goodId(id)) throw new Error('CATEGORY_REFERENCE_INVALID')
    refs.push({kind,localId:id})
  }
  const many = (kind:CategoryKind, values:unknown) => {
    if (values === undefined || values === null) return
    if (!Array.isArray(values) || values.length > 1000) throw new Error('CATEGORY_REFERENCE_INVALID')
    for (const id of values) add(kind,id)
  }
  const rel = (kind:CategoryKind, values:unknown, key='targetId') => {
    if (values === undefined || values === null) return
    if (!Array.isArray(values) || values.length > 1000) throw new Error('CATEGORY_REFERENCE_INVALID')
    for (const value of values) {
      if (!obj(value)) throw new Error('CATEGORY_REFERENCE_INVALID')
      add(kind,value[key])
    }
  }
  if (row.kind==='character') {
    add('country',c.countryId)
    rel('character',c.relatedCharacters,'characterId')
    rel('worldEntry',c.relatedNotes)
    if (c.cloudRelations !== undefined) {
      if (!Array.isArray(c.cloudRelations) || c.cloudRelations.length > 100) throw new Error('CATEGORY_REFERENCE_INVALID')
      for (const relation of c.cloudRelations) {
        if (!obj(relation) || !isUuid(relation.targetId)) throw new Error('CATEGORY_REFERENCE_INVALID')
        refs.push({kind:'character',uuid:String(relation.targetId).toLowerCase()})
      }
    }
  }
  if (row.kind==='event') {
    many('character',c.characters);many('country',c.countries)
    add('event',c.parentEventId);rel('event',c.relations)
  }
  if (row.kind==='country') add('country',c.parentId)
  if (row.kind==='worldEntry') {
    add('worldEntry',c.parentId);rel('worldEntry',c.relations)
    if (c.references !== undefined) {
      if (!Array.isArray(c.references) || c.references.length > 1000) throw new Error('CATEGORY_REFERENCE_INVALID')
      for (const ref of c.references) {
        if (!obj(ref)) throw new Error('CATEGORY_REFERENCE_INVALID')
        const kind = ref.targetType==='world' ? 'worldEntry' : ref.targetType
        if (!kinds.has(kind as CategoryKind)) throw new Error('CATEGORY_REFERENCE_INVALID')
        add(kind as CategoryKind,ref.targetId)
      }
    }
  }
  refs.push(...documentDependencies(c))
  return refs
}

export function collectCategoryClosure<T extends CategoryRecord>(
  rows: T[], selection:CategorySelection,
): {rows:T[];primary:number} {
  const byId=new Map(rows.map(row=>[row.kind+':'+row.localId,row]))
  const byUuid=new Map(rows.map(row=>[row.sourceId.toLowerCase(),row]))
  const primary=selectCategoryRecords(rows,selection)
  const chosen=new Map<string,T>()
  const pending=[...primary]
  while(pending.length) {
    const row=pending.shift()!
    const key=row.kind+':'+row.localId
    if (chosen.has(key)) continue
    if (chosen.size>=500) throw new Error('CATEGORY_TOO_LARGE')
    chosen.set(key,row)
    for (const ref of entityDependencies(row)) {
      const target=ref.uuid ? byUuid.get(ref.uuid) : byId.get(ref.kind+':'+ref.localId)
      // Existing workspaces may contain legacy references to deleted entries;
      // only resolvable, active references may be carried into a new workspace.
      if (!target) throw new Error('CATEGORY_REFERENCE_MISSING')
      pending.push(target)
    }
  }
  return {rows:[...chosen.values()],primary:primary.length}
}

export function collectArchiveMedia(records: Pick<CategoryRecord,'content'>[]): Set<string> {
  const found=new Set<string>()
  const visit=(value:unknown,depth:number):void=>{
    if(depth>25)throw new Error('CATEGORY_TOO_DEEP')
    if(typeof value==='string') {
      const match=/^\/api\/media\/([0-9a-f-]{36})$/i.exec(value)
      if(match) {
        if(!isUuid(match[1]))throw new Error('CATEGORY_MEDIA_INVALID')
        found.add(match[1].toLowerCase())
      }
    } else if(Array.isArray(value)) {
      for(const child of value)visit(child,depth+1)
    } else if(obj(value)) {
      for(const child of Object.values(value))visit(child,depth+1)
    }
  }
  for(const row of records)visit(row.content,0)
  return found
}

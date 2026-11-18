import { matchRow, searchTerms, buildSnippet, type SearchMatchField } from '@/lib/search/matcher'

export type CloudSearchKind='character'|'event'|'country'|'world'|'novel'|'map'
export interface CloudSearchRecord {
  id:string;local_id:number|string;kind:string;title:string;content:Record<string,unknown>
}
export interface CloudSearchHit {
  entityId:string;localId:number;kind:CloudSearchKind;title:string;category:string|null;
  matched:SearchMatchField;score:number;snippet?:string
}
function textual(value:unknown,maxDepth=6):string {
  const chunks:string[]=[]
  let total=0
  const visit=(part:unknown,depth:number)=>{
    if(total>=30000||depth>maxDepth)return
    if(typeof part==='string'){
      if(part.length>12000||/^data:|^\/api\/media\//.test(part))return
      chunks.push(part);total+=part.length
    } else if(Array.isArray(part)){
      for(const item of part.slice(0,300))visit(item,depth+1)
    } else if(part&&typeof part==='object'){
      for(const [key,item] of Object.entries(part).slice(0,80)){
        if(['attrs','src','url','id','uuid','media','mapImage','avatarUrl','headerUrl','cover'].includes(key))continue
        visit(item,depth+1)
      }
    }
  }
  visit(value,0)
  return chunks.join(' ')
}
/** Original search matcher: title > alias > fields > rich-text body. */
export function indexCloudWorkspaceSearch(rows:readonly CloudSearchRecord[],query:string):CloudSearchHit[]{
  const terms=searchTerms(query)
  if(terms.length===0||terms.length>8||query.length>120)return []
  const results:CloudSearchHit[]=[]
  for(const row of rows){
    const data=row.content??{}
    const kind:CloudSearchKind=row.kind==='worldEntry'
      ?data.category==='小说'?'novel':data.category==='地图'?'map':'world'
      :row.kind==='character'||row.kind==='event'||row.kind==='country'?row.kind:'world'
    const aliases=Array.isArray(data.aliases)?data.aliases.filter(v=>typeof v==='string') as string[]:[]
    const fields=textual([data.summary,data.bio,data.description,data.race,data.occupation,
      data.faction,data.system,data.location,data.time,data.custom,data.content])
    const body=textual(data.document)
    const matched=matchRow({titleLower:row.title.toLocaleLowerCase('zh-Hans'),
      aliasesLower:aliases.map(a=>a.toLocaleLowerCase('zh-Hans')),
      fieldLower:fields.toLocaleLowerCase('zh-Hans'),bodyLower:body.toLocaleLowerCase('zh-Hans')},terms)
    if(!matched)continue
    const snippet=buildSnippet(body,terms)??buildSnippet(fields,terms)??undefined
    results.push({
      entityId:row.id,localId:Number(row.local_id),title:row.title,kind,
      category:typeof data.category==='string'&&data.category?data.category:null,
      matched:matched.matched,score:matched.score,...(snippet?{snippet}:{})
    })
  }
  return results.sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title,'zh-Hans'))
}

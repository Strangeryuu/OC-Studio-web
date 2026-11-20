import { describe, expect, it } from 'vitest'
import {
  CATEGORY_FORMAT, collectArchiveMedia, collectCategoryClosure, entityDependencies,
  parseCategoryArchive, readCategorySelection, recordKey, remapCategoryDocumentRefs,
  type CategoryArchive, type CategoryRecord,
} from '@/lib/cloud/category-archive'
import { remapPortableContent } from '@/lib/cloud/backup-format'

const ids=[
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
]
const row=(index:number,kind:CategoryRecord['kind'],title:string,content:Record<string,unknown>):CategoryRecord=>({
  sourceId:ids[index],localId:index+1,kind,title,content,
})
const rows:CategoryRecord[]=[
  row(0,'character','阿羽',{name:'阿羽',folder:'主角',countryId:2,relatedCharacters:[{
    characterId:4,name:'烟玖',relation:'表姐',
  }],document:{type:'doc',content:[{type:'paragraph',content:[{
    type:'mention',attrs:{id:'3',entityType:'event',label:'命运之夜'},
  }]}]}}),
  row(1,'country','王国',{name:'王国'}),
  row(2,'event','命运之夜',{title:'命运之夜',characters:[1]}),
  row(3,'character','烟玖',{name:'烟玖',folder:'配角'}),
]
const example:CategoryArchive={
  format:CATEGORY_FORMAT,version:1,sourceName:'源世界观',exportedAt:'2026-11-20T01:00:00Z',
  selection:{kind:'character',folder:'主角'},records:rows,assets:[],tags:[],
}

describe('selective cloud category archive',()=>{
  it('selects a folder and brings along graph dependencies, including text mentions',()=>{
    const result=collectCategoryClosure(rows,{kind:'character',folder:'主角'})
    expect(result.primary).toBe(1)
    expect(result.rows.map(item=>item.title).sort()).toEqual(['命运之夜','王国','烟玖','阿羽'].sort())
    expect(entityDependencies(rows[0])).toEqual(expect.arrayContaining([
      {kind:'country',localId:2},{kind:'event',localId:3},
      {kind:'character',localId:4},
    ]))
    expect(collectCategoryClosure(rows,{kind:'country'}).rows.map(item=>item.title)).toEqual(['王国'])
  })

  it('rejects malformed format, forged identities and ambiguous duplicate local ids',()=>{
    expect(parseCategoryArchive(example)?.records).toHaveLength(4)
    expect(parseCategoryArchive({...example,format:'oc-editor-ocav'})).toBeNull()
    expect(parseCategoryArchive({...example,version:2})).toBeNull()
    expect(parseCategoryArchive({...example,records:[rows[0],rows[0]]})).toBeNull()
    expect(parseCategoryArchive({...example,records:[{...rows[0],sourceId:'bad'}]})).toBeNull()
    expect(parseCategoryArchive({...example,assets:[{id:ids[0],mime:'text/html',base64:'PGh0bWw+'}]})).toBeNull()
    expect(parseCategoryArchive({...example,records:[{...rows[0],content:{
      ...rows[0].content,avatarUrl:'https://attacker.example/avatar.png',
    }},...rows.slice(1)]})).toBeNull()
    expect(parseCategoryArchive({...example,records:[{...rows[0],content:{
      ...rows[0].content,document:JSON.stringify({type:'doc',content:[
        {type:'imageBlock',attrs:{src:'https://attacker.example/pixel.png'}},
      ]}),
    }},...rows.slice(1)]})).toBeNull()
    expect(readCategorySelection({kind:'country',folder:'主角'})).toBeNull()
    expect(readCategorySelection({kind:'worldEntry',category:'自定义'})).toEqual({
      kind:'worldEntry',category:'自定义',
    })
  })

  it('maps a TipTap mention to a fresh numeric ID with its entity kind',()=>{
    const transformed=remapCategoryDocumentRefs(rows[0].content,
      new Map([['event:3',40]]))
    const document=transformed.document as {content:{content:{attrs:{id:string}}[]}[]}
    expect(document.content[0].content[0].attrs.id).toBe('40')
    expect((rows[0].content.document as {content:{content:{attrs:{id:string}}[]}[]})
      .content[0].content[0].attrs.id).toBe('3')
    expect(()=>remapCategoryDocumentRefs(rows[0].content,new Map())).toThrow('CATEGORY_REFERENCE_MISSING')
  })

  it('remaps mixed typed world references to the corresponding target entities',()=>{
    const maps={local:new Map([['character:1',15],['country:2',16],['event:3',17]]),
      uuid:new Map<string,string>(),media:new Map<string,string>(),tags:new Map<string,string>()}
    const result=remapPortableContent('worldEntry',{references:[
      {targetType:'character',targetId:1},{targetType:'country',targetId:2},
      {targetType:'event',targetId:3},
    ]},maps)
    expect(result.references).toEqual([
      {targetType:'character',targetId:15},{targetType:'country',targetId:16},
      {targetType:'event',targetId:17},
    ])
  })

  it('scopes duplicate names by entity kind and world entry category',()=>{
    expect(recordKey('worldEntry',' 风暴 ',{category:'人物'}))
      .not.toBe(recordKey('worldEntry','风暴',{category:'事件'}))
    expect(recordKey('character','阿羽',{name:'阿羽'}))
      .toBe(recordKey('character',' 阿羽 ',{}))
    expect(collectArchiveMedia([{content:{gallery:[{url:'/api/media/'+ids[0]}],
      nested:{src:'/api/media/'+ids[1]},other:'https://example.com/image.png'}}]))
      .toEqual(new Set([ids[0],ids[1]]))
  })
})

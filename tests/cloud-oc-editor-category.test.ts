import {describe,expect,it} from 'vitest'
import {convertOcEditorCategory,detectArchiveType,parseSupportedCategory} from '@/lib/cloud/oc-editor-category'
import {parseCategoryArchive} from '@/lib/cloud/category-archive'
import {parsePortableBackup} from '@/lib/cloud/backup-format'

const id=(row:number)=>'91000001-0000-4000-8000-'+row.toString(16).padStart(12,'0')
function native(kind:string,table:string,items:Record<string,unknown>[],context:Record<string,unknown>={},extra:Record<string,unknown>={}) {
  return {format:'oc-editor-ocav',version:1,kind,
    world:{name:'OC-editor 世界'},exportedAt:'2026-11-20T00:00:00Z',
    payload:{table,contextMode:'create',items,
      context:{characters:[],countries:[],events:[],worldEntries:[],tags:[],...context},
      folders:[{id:'fold-1',name:'核心角色'}],refs:[] as Record<string,unknown>[]},
    relations:[],...extra}
}
const character={
  id:1,name:'斯兰特 羽',aliases:['羽'],bio:'学生',folderId:'fold-1',avatarUrl:'',
  relatedCharacters:[{characterId:2,name:'烟玖',relation:'表姐'}],
  countryId:3,tags:[10],
  document:{type:'doc',content:[{type:'paragraph',content:[
    {type:'mention',attrs:{entityType:'country',id:'3',label:'王国'}},
  ]}]},
}
const cousin={id:2,name:'烟玖',bio:'守护者',avatarUrl:'',relatedCharacters:[]}
const nation={id:3,name:'王国',flagUrl:'',system:'联邦'}
const tag={id:10,name:'亲属',color:'#123abc'}

describe('OC-editor native OCAV protocol compatibility',()=>{
  it('distinguishes three .ocbak types and leaves original v1 backup parser intact',()=>{
    const original={version:1,data:{characters:[],events:[],countries:[],worldEntries:[],tags:[],periods:[],meta:[]}}
    const nativeFile=native('character','characters',[character],{tags:[tag]})
    expect(detectArchiveType(nativeFile)).toBe('oc-editor')
    expect(detectArchiveType(original)).toBe('oc-studio-full')
    expect(parsePortableBackup(original)?.source).toBe('legacy')
    expect(parseSupportedCategory(original)).toBeNull()
    expect(parsePortableBackup(nativeFile)).toBeNull()
    const nativeArchive=convertOcEditorCategory(nativeFile)!
    expect(detectArchiveType(nativeArchive)).toBe('web-category')
    expect(parseCategoryArchive(nativeArchive)).not.toBeNull()
  })
  it('transfers primary characters, relation context, folders, tags and rich-text mentions',()=>{
    const file=native('character','characters',[character],{
      characters:[cousin],countries:[nation],tags:[tag],
    },{relations:[{
      id:'character:1->character:2',sourceType:'character',sourceId:1,
      targetType:'character',targetId:2,kind:'character',label:'表姐',
      directed:false,color:'#112233',arrow:'both',
    }]})
    const archive=convertOcEditorCategory(file)!
    expect(archive.selection).toEqual({kind:'character'})
    expect(archive.sourceFormat).toBe('oc-editor-ocav')
    expect(archive.records).toHaveLength(3)
    expect(archive.records[0].sourceId).toBe(id(1))
    expect(archive.records[0].content.folder).toBe('核心角色')
    expect(archive.records[0].content.cloudTagIds).toEqual([archive.tags[0].id])
    expect(archive.records[0].content.document).toEqual(character.document)
    const relations=archive.records[0].content.relatedCharacters as {characterId:number;relation:string}[]
    expect(relations.filter(r=>r.characterId===2&&r.relation==='表姐')).toHaveLength(1)
    expect(archive.nativeRelations).toBe(1)
    expect(archive.tags[0].name).toBe('亲属')
  })
  it('identifies actual row shape over inaccurate headers and rejects mixed types',()=>{
    const wrong=native('country','countries',[character],{tags:[tag]})
    const a=convertOcEditorCategory(wrong)!
    expect(a.selection.kind).toBe('character')
    expect(a.records[0].kind).toBe('character')
    expect(()=>convertOcEditorCategory(native('country','countries',[nation,character])))
      .toThrow('OC_EDITOR_MIXED_KINDS')
  })
  it('keeps explicit refs for link-only OC-editor world-entry archives',()=>{
    const file=native('world-entry','worldEntries',[
      {id:10,title:'起源',category:'神话',content:'文本',
        references:[{targetType:'character',targetId:1}],document:{type:'doc',content:[]}},
    ])
    file.payload.contextMode='link-only'
    file.payload.refs=[{type:'character',id:1,name:'斯兰特 羽'}]
    const archive=convertOcEditorCategory(file)!
    expect(archive.externalRefs).toEqual([{kind:'character',localId:1,name:'斯兰特 羽'}])
    expect(archive.records[0].content.references).toEqual([{targetType:'character',targetId:1}])
  })
  it('migrates custom-section entries and scoped relation graph to native notes',()=>{
    const file=native('custom-section','customSections',[
      {id:'section-1',name:'神器',description:'法器分类',entries:[
        {id:'entry-one',name:'圣剑',note:'自带光辉',gallery:[],relatedEntryIds:['entry-two'],
          entryLinks:{'entry-two':{relation:'守护'}}},
        {id:'entry-two',name:'封印',note:'古老契约',gallery:[]},
      ],scopedEdges:[{id:'edge-1',source:'entry-one',target:'entry-two',label:'守护'}]},
    ])
    const archive=convertOcEditorCategory(file)!
    expect(archive.selection).toEqual({kind:'worldEntry',category:'神器'})
    expect(archive.records.map(x=>x.title)).toEqual(['圣剑','封印'])
    expect(archive.records[0].content.relations).toEqual([{targetId:2,relation:'守护',name:'封印'}])
    expect(archive.records[0].content.ocEditorSection).toMatchObject({
      description:'法器分类',entryId:'entry-one',
    })
  })
  it('deduplicates embedded images and refuses remote image URLs',()=>{
    const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVQIHWP4//8/AwAI/AL+9tpZ3gAAAABJRU5ErkJggg=='
    const file=native('character','characters',[{
      ...character,avatarUrl:'data:image/png;base64,'+base64,
      gallery:['data:image/png;base64,'+base64],
    }],{characters:[cousin],countries:[nation],tags:[tag]})
    const archive=convertOcEditorCategory(file)!
    expect(archive.assets).toHaveLength(1)
    expect(archive.records[0].content.avatarUrl).toBe('/api/media/'+archive.assets[0].id)
    expect(archive.records[0].content.gallery).toEqual(['/api/media/'+archive.assets[0].id])
    expect(()=>convertOcEditorCategory(native('character','characters',[{
      ...character,avatarUrl:'https://malicious.invalid/image.png',
    }],{characters:[cousin],countries:[nation],tags:[tag]}))).toThrow('OC_EDITOR_INVALID')
  })
})

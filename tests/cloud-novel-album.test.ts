import { describe, expect, it } from 'vitest'
import { buildDefaultCharacter } from '@/features/characters/services'
import { buildDefaultCountry } from '@/features/countries/services'
import { buildDefaultEvent } from '@/features/events/services'
import { buildDefaultEntry } from '@/features/world/services'
import { newCharacterData, newCountryData, newEventData, newWorldEntryData } from '@/lib/entity-defaults'
import { projectCloudAlbum } from '@/features/album/cloud/cloud-album-projection'
import { cloudNovelBooks, novelSubtree, novelChapterTree, filterCloudNovelTree, safeNovelFileName } from '@/features/novel/cloud/cloud-novel-projection'
import { flattenNovel, countNovelWords, toMarkdown, toTxt } from '@/features/novel/export'
import { paginateNovel } from '@/features/novel/pagination'

const asset = (n: number) => '/api/media/00000000-0000-4000-8000-' + String(n).padStart(12,'0')
const note = (id:number,title:string,parentId:number|null,category='小说',order=id) => ({
  ...buildDefaultEntry({ ...newWorldEntryData(), title, parentId, category, order }), id,
})
const paragraph = (text:string) => ({ type:'doc', content:[{type:'paragraph',content:[{type:'text',text}]}] })

describe('cloud original novel and album projections', () => {
  it('uses the original novel hierarchy and export functions without mixing books', () => {
    const bookA = {...note(1,'第一本',null), novelAuthor:'作者甲'}
    const chapterA = {...note(2,'第一章',1), document: paragraph('你好世界')}
    const sub = {...note(3,'第一节',2), document:paragraph('继续')}
    const bookB = note(4,'第二本',null)
    const other = {...note(5,'普通笔记',null,'',0)}
    const all = [bookA,chapterA,sub,bookB,other]
    const books=cloudNovelBooks(all)
    expect(books.map(book=>book.title)).toEqual(['第一本','第二本'])
    expect(books[0].chapters).toBe(2)
    expect(books[0].words).toBe(6)
    expect(novelSubtree(all,bookA.id).map(item=>item.id)).toHaveLength(3)
    const originalTree=novelChapterTree(all,bookA.id)
    expect(originalTree[0].children[0].entry.id).toBe(sub.id)
    expect(filterCloudNovelTree(originalTree,'第一节')[0].entry.title).toBe('第一章')
    expect(filterCloudNovelTree(originalTree,'第一节')[0].children[0].entry.id).toBe(sub.id)
    expect(filterCloudNovelTree(originalTree,'找不到')).toEqual([])
    const output=flattenNovel(novelSubtree(all,bookA.id).filter(row=>row.id!==bookA.id))
    expect(countNovelWords(output)).toBe(6)
    expect(toTxt(output,{title:'第一本'})).toContain('第一章')
    expect(toMarkdown(flattenNovel([chapterA,sub],{markdown:true}),{title:'第一本'})).toContain('# 第一本')
    expect(paginateNovel(output,'9:16').length).toBeGreaterThanOrEqual(1)
    expect(safeNovelFileName('A/B:书.docx')).toBe('A-B-书.docx')
  })

  it('includes the original world-cover album category only for private workspace media', () => {
    const empty = {characters:[],countries:[],events:[],notes:[]}
    const projected = projectCloudAlbum({...empty, worldCoverUrl:asset(20), worldName:'群星世界'})
    expect(projected).toEqual([{url:asset(20),sourceName:'群星世界',sourceType:'world',
      sourceId:1,category:'cover',updatedAt:0,tags:[]}])
    expect(projectCloudAlbum({...empty, worldCoverUrl:'https://example.invalid/cover.png'}))
      .toEqual([])
  })
  it('collects only private workspace media from the original album slots and body', () => {
    const character={...buildDefaultCharacter({
      ...newCharacterData(),name:'云端角色',avatarUrl:asset(1),
      gallery:[{url:asset(2),caption:''}],
    }),id:100}
    const country={...buildDefaultCountry({...newCountryData(),name:'云端国家'}),id:101,
      flagUrl:asset(3)}
    const event={...buildDefaultEvent({...newEventData(),title:'云端事件'}),id:102,
      headerUrl:asset(4)}
    const entry={...note(103,'设定笔记',null,''),cover:asset(5),document:{
      type:'doc',content:[{type:'imageBlock',attrs:{src:asset(6)}}],
    }}
    const novel={...note(104,'小说',null,'小说'),novelCover:asset(7)}
    const map={...note(105,'地图',null,'地图'),mapImage:asset(8)}
    const remote={...note(106,'远程图片',null,''),cover:'https://example.invalid/image.jpg'}
    const images=projectCloudAlbum({characters:[character],countries:[country],events:[event],
      notes:[entry,novel,map,remote]})
    expect(images.map(image=>image.url)).toEqual(
      expect.arrayContaining([asset(1),asset(2),asset(3),asset(4),asset(5),asset(6)]))
    expect(images).toHaveLength(6)
    expect(images.find(image=>image.url===asset(6))?.category).toBe('body')
    expect(images.every(image=>image.sourceType!=='map')).toBe(true)
    expect(images.every(image=>image.sourceType!=='novel')).toBe(true)
  })
})

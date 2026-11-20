// @vitest-environment node
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'
vi.mock('server-only',()=>({}))
import {issueCategoryOverwritePreview,verifyCategoryOverwritePreview} from
  '@/lib/cloud/server/category-import-preview'
import type {CategoryArchive} from '@/lib/cloud/category-archive'

const archive:CategoryArchive={
  format:'oc-studio-web-category-v1',version:1,sourceName:'原作者',
  exportedAt:'2026-11-20T01:00:00Z',selection:{kind:'character'},
  records:[{kind:'character',sourceId:'11111111-1111-4111-8111-111111111111',
    localId:1,title:'星河',content:{name:'星河',avatarUrl:'',tags:[]}}],
  tags:[],assets:[],
}
const targets=[{sourceKey:'record:character:1',
  targetId:'22222222-2222-4222-8222-222222222222',version:2}]
const options={archive,workspaceId:'33333333-3333-4333-8333-333333333333',
  actorId:'owner-1',targets,now:1000000}
let originalSecret:string|undefined
describe('signed category overwrite preview tickets',()=>{
  beforeAll(()=>{
    originalSecret=process.env.BETTER_AUTH_SECRET
    process.env.BETTER_AUTH_SECRET='test-only-category-import-preview-strong-secret-0000'
  })
  afterAll(()=>{
    if(originalSecret===undefined)delete process.env.BETTER_AUTH_SECRET
    else process.env.BETTER_AUTH_SECRET=originalSecret
  })
  it('authenticates identical versions in a different row order',()=>{
    const token=issueCategoryOverwritePreview(options)
    expect(()=>verifyCategoryOverwritePreview({...options,token})).not.toThrow()
    expect(()=>verifyCategoryOverwritePreview({...options,targets:[...targets].reverse(),token})).not.toThrow()
  })
  it('denies changed target versions, extra collisions and altered content',()=>{
    const token=issueCategoryOverwritePreview(options)
    expect(()=>verifyCategoryOverwritePreview({...options,token,
      targets:[{...targets[0],version:3}]})).toThrow('CATEGORY_PREVIEW_STALE')
    expect(()=>verifyCategoryOverwritePreview({...options,token,
      targets:[...targets,{sourceKey:'external:country:4',targetId:null,version:null}]}))
      .toThrow('CATEGORY_PREVIEW_STALE')
    expect(()=>verifyCategoryOverwritePreview({...options,token,
      archive:{...archive,records:[{...archive.records[0],title:'不同的角色'}]}}))
      .toThrow('CATEGORY_PREVIEW_STALE')
  })
  it('denies cross-world, cross-account and unsigned confirmation',()=>{
    const token=issueCategoryOverwritePreview(options)
    expect(()=>verifyCategoryOverwritePreview({...options,token,
      workspaceId:'44444444-4444-4444-8444-444444444444'}))
      .toThrow('CATEGORY_PREVIEW_INVALID')
    expect(()=>verifyCategoryOverwritePreview({...options,token,
      actorId:'another-user'})).toThrow('CATEGORY_PREVIEW_INVALID')
    expect(()=>verifyCategoryOverwritePreview({...options,token:token+'x'}))
      .toThrow('CATEGORY_PREVIEW_INVALID')
    expect(()=>verifyCategoryOverwritePreview({...options,token:null}))
      .toThrow('CATEGORY_PREVIEW_INVALID')
  })
  it('expires after 15 minutes',()=>{
    const token=issueCategoryOverwritePreview(options)
    expect(()=>verifyCategoryOverwritePreview({...options,token,now:1000000+15*60*1000+1}))
      .toThrow('CATEGORY_PREVIEW_EXPIRED')
  })
})

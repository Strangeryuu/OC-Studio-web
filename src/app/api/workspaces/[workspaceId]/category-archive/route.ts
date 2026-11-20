import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { pool } from '@/lib/cloud/server/db'
import { readCategorySelection, type CategoryStrategy } from '@/lib/cloud/category-archive'
import { categoryExportOptions, exportCategoryArchive, importCategoryArchive, previewCategoryImport } from '@/lib/cloud/server/category-archive-io'

export const runtime='nodejs'
export const dynamic='force-dynamic'
type Context={params:Promise<{workspaceId:string}>}
const MAX_BYTES=40_000_000
const responseError=(code:string,status:number)=>NextResponse.json({error:code},{status,headers:{'Cache-Control':'private, no-store'}})
function errorCode(cause:unknown):string {
  const code=cause instanceof Error?cause.message:''
  const mapping:Record<string,string>={
    BACKUP_REFERENCE_MISSING:'CATEGORY_REFERENCE_MISSING',
    BACKUP_REFERENCE_INVALID:'CATEGORY_REFERENCE_INVALID',
    BACKUP_MEDIA_MISSING:'CATEGORY_MEDIA_MISSING',
    BACKUP_TAG_MISSING:'CATEGORY_TAG_INVALID',
  }
  return mapping[code]??(/^(CATEGORY|OC_EDITOR)_[A-Z_]+$/.test(code)?code:'CATEGORY_OPERATION_FAILED')
}
async function boundedBody(request:Request):Promise<unknown> {
  if(Number(request.headers.get('content-length')??0)>MAX_BYTES)throw new Error('CATEGORY_TOO_LARGE')
  if(!request.body)throw new Error('CATEGORY_INVALID')
  const reader=request.body.getReader()
  let size=0
  const chunks:Buffer[]=[]
  try {
    while(true) {
      const part=await reader.read()
      if(part.done)break
      size+=part.value.byteLength
      if(size>MAX_BYTES) {
        await reader.cancel()
        throw new Error('CATEGORY_TOO_LARGE')
      }
      chunks.push(Buffer.from(part.value))
    }
  } finally {reader.releaseLock()}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown}
  catch {throw new Error('CATEGORY_INVALID')}
}

export async function GET(request:Request,context:Context) {
  const user=await currentCloudUser()
  if(!user)return responseError('UNAUTHORIZED',401)
  const {workspaceId}=await context.params
  if(!isUuid(workspaceId)||!await authorizedWorkspace(user,workspaceId,'export:create'))
    return responseError('NOT_FOUND',404)
  const url=new URL(request.url)
  if(url.searchParams.get('mode')==='options') {
    try {return NextResponse.json(await categoryExportOptions(workspaceId),{headers:{'Cache-Control':'private, no-store'}})}
    catch(cause){return responseError(errorCode(cause),409)}
  }
  const selection=readCategorySelection({
    kind:url.searchParams.get('kind'),
    ...(url.searchParams.has('folder')?{folder:url.searchParams.get('folder')}:{}),
    ...(url.searchParams.has('category')?{category:url.searchParams.get('category')}:{}),
  })
  if(!selection)return responseError('CATEGORY_INVALID_SELECTION',400)
  const found=await pool.query<{name:string}>(
    'SELECT name FROM workspaces WHERE id=$1 AND deleted_at IS NULL',[workspaceId])
  if(found.rowCount!==1)return responseError('NOT_FOUND',404)
  try {
    const archive=await exportCategoryArchive(workspaceId,found.rows[0].name,selection)
    const body=JSON.stringify(archive)
    return new Response(body,{status:200,headers:{
      'Content-Type':'application/octet-stream',
      'Content-Disposition':'attachment; filename="oc-studio-category.ocbak"',
      'Content-Length':String(Buffer.byteLength(body)),
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff',
    }})
  }catch(cause) {
    const code=errorCode(cause)
    return responseError(code,code==='CATEGORY_EMPTY'?404:code==='CATEGORY_TOO_LARGE'?413:409)
  }
}

export async function POST(request:Request,context:Context) {
  if(!mutationOriginAllowed(request))return responseError('INVALID_ORIGIN',403)
  const user=await currentCloudUser()
  if(!user)return responseError('UNAUTHORIZED',401)
  const {workspaceId}=await context.params
  if(!isUuid(workspaceId)||!await authorizedWorkspace(user,workspaceId,'workspace:update'))
    return responseError('NOT_FOUND',404)
  let input:unknown
  try {input=await boundedBody(request)}
  catch(cause) {
    const code=errorCode(cause)
    return responseError(code,code==='CATEGORY_TOO_LARGE'?413:400)
  }
  if(!input||typeof input!=='object'||Array.isArray(input))
    return responseError('CATEGORY_INVALID',400)
  const fields=input as Record<string,unknown>
  try {
    if(fields.action==='preview') {
      const result=await previewCategoryImport(workspaceId,user.id,fields.archive)
      return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}})
    }
    if(fields.action==='import') {
      const strategy=fields.strategy as CategoryStrategy
      if(strategy!=='skip'&&strategy!=='keep-both'&&strategy!=='overwrite')
        return responseError('CATEGORY_INVALID_STRATEGY',400)
      const result=await importCategoryArchive(workspaceId,user.id,fields.archive,strategy,fields.previewToken)
      return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}})
    }
    return responseError('CATEGORY_INVALID_ACTION',400)
  }catch(cause) {
    const code=errorCode(cause)
    return responseError(code,code==='CATEGORY_TOO_LARGE'?413:
      code==='CATEGORY_AMBIGUOUS_SOURCE'||code==='CATEGORY_AMBIGUOUS_TARGET'||
      code==='CATEGORY_NAME_CONFLICT'||code==='CATEGORY_PREVIEW_STALE'||
      code==='CATEGORY_PREVIEW_EXPIRED'?409:400)
  }
}

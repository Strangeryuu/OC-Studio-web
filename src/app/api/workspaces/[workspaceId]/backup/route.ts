import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { pool } from '@/lib/cloud/server/db'
import { exportWorkspaceBackup, importWorkspaceBackup } from '@/lib/cloud/server/backup-io'
export const runtime='nodejs'
export const dynamic='force-dynamic'
type Context={params:Promise<{workspaceId:string}>}
const MAX_IMPORT_BYTES=60*1024*1024
function userError(cause:unknown):string {
  if(cause instanceof Error&&/^[A-Z_]+$/.test(cause.message))return cause.message
  return 'BACKUP_OPERATION_FAILED'
}

export async function GET(_request:Request,context:Context){
  const user=await currentCloudUser()
  if(!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})
  const {workspaceId}=await context.params
  if(!isUuid(workspaceId)||!await authorizedWorkspace(user,workspaceId,'export:create'))
    return NextResponse.json({error:'NOT_FOUND'},{status:404})
  const target=await pool.query<{name:string}>('SELECT name FROM workspaces WHERE id=$1 AND deleted_at IS NULL',[workspaceId])
  if(target.rowCount!==1)return NextResponse.json({error:'NOT_FOUND'},{status:404})
  try{
    const output=await exportWorkspaceBackup(workspaceId,target.rows[0].name)
    return new Response(output,{status:200,headers:{
      'Content-Type':'application/octet-stream',
      'Content-Disposition':'attachment; filename="oc-studio-cloud.ocbak"',
      'Content-Length':String(Buffer.byteLength(output)),
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff',
    }})
  }catch(cause){return NextResponse.json({error:userError(cause)},{status:409})}
}

export async function POST(request:Request,context:Context){
  if(!mutationOriginAllowed(request))return NextResponse.json({error:'INVALID_ORIGIN'},{status:403})
  const user=await currentCloudUser()
  if(!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})
  const {workspaceId}=await context.params
  if(!isUuid(workspaceId)||!await authorizedWorkspace(user,workspaceId,'workspace:update'))
    return NextResponse.json({error:'NOT_FOUND'},{status:404})
  if(Number(request.headers.get('content-length')??0)>MAX_IMPORT_BYTES)
    return NextResponse.json({error:'BACKUP_TOO_LARGE'},{status:413})
  if(!request.body)return NextResponse.json({error:'INVALID_BACKUP'},{status:400})
  const reader=request.body.getReader()
  const chunks:Uint8Array[]=[]
  let total=0
  try{
    while(true){
      const result=await reader.read()
      if(result.done)break
      total+=result.value.byteLength
      if(total>MAX_IMPORT_BYTES){
        await reader.cancel()
        return NextResponse.json({error:'BACKUP_TOO_LARGE'},{status:413})
      }
      chunks.push(result.value)
    }
  }finally{reader.releaseLock()}
  let payload:unknown
  try{payload=JSON.parse(Buffer.concat(chunks.map(b=>Buffer.from(b))).toString('utf8'))}
  catch{return NextResponse.json({error:'INVALID_BACKUP'},{status:400})}
  try{
    const result=await importWorkspaceBackup(workspaceId,user.id,payload)
    return NextResponse.json(result)
  }catch(cause){
    const code=userError(cause)
    return NextResponse.json({error:code},{
      status:code==='RESTORE_TARGET_NOT_EMPTY'||code==='VERSION_CONFLICT'?409:
        code==='BACKUP_TOO_LARGE'?413:400,
    })
  }
}

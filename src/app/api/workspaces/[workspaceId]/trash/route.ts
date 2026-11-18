import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { isUuid } from '@/lib/cloud/server/authorization'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const user=await currentCloudUser()
  if(!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})
  const {workspaceId}=await context.params
  if(!isUuid(workspaceId)||!await authorizedWorkspace(user,workspaceId,'entity:read'))
    return NextResponse.json({error:'NOT_FOUND'},{status:404})
  const params=new URL(request.url).searchParams
  const offsetText=params.get('after')
  const offset=offsetText===null?0:Number(offsetText)
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000)
    return NextResponse.json({error:'INVALID_CURSOR'},{status:400})
  const result=await pool.query<{
    id:string;local_id:string;kind:string;title:string;version:number;
    deleted_at:string;content:Record<string,unknown>
  }>(`SELECT id,local_id,kind,title,version,deleted_at,content
     FROM entities WHERE workspace_id=$1 AND deleted_at IS NOT NULL
     ORDER BY deleted_at DESC,local_id LIMIT 101 OFFSET $2`,[workspaceId,offset])
  return NextResponse.json({
    items:result.rows.slice(0,100).map(row=>({
      id:row.id,localId:Number(row.local_id),kind:row.kind,title:row.title,version:row.version,
      category:typeof row.content.category==='string'?row.content.category:null,
      parentId:typeof row.content.parentId==='number'?row.content.parentId:null,
      deletedAt:row.deleted_at,
    })),
    nextCursor:result.rows.length>100?String(offset+100):null,
  },{headers:{'Cache-Control':'private, no-store'}})
}

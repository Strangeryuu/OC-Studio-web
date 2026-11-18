import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { pool } from '@/lib/cloud/server/db'
import { defaultWorkspaceCustomization, readWorkspaceCustomization } from '@/lib/cloud/workspace-customization'
export const runtime='nodejs'
export const dynamic='force-dynamic'
type Context={params:Promise<{workspaceId:string}>}

export async function GET(_request:Request, context:Context){
  const user=await currentCloudUser()
  if(!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})
  const {workspaceId}=await context.params
  if(!isUuid(workspaceId)||!await authorizedWorkspace(user,workspaceId,'workspace:read'))
    return NextResponse.json({error:'NOT_FOUND'},{status:404})
  const found=await pool.query<{setting_value:unknown;version:number}>(
    "SELECT setting_value,version FROM workspace_settings WHERE workspace_id=$1 AND setting_key='customization'",
    [workspaceId])
  const row=found.rows[0]
  const customization=row?readWorkspaceCustomization(row.setting_value):defaultWorkspaceCustomization()
  if(!customization)return NextResponse.json({error:'INVALID_SAVED_CUSTOMIZATION'},{status:500})
  return NextResponse.json({customization,version:row?.version??0},
    {headers:{'Cache-Control':'private, no-store'}})
}

export async function PUT(request:Request,context:Context){
  if(!mutationOriginAllowed(request))return NextResponse.json({error:'INVALID_ORIGIN'},{status:403})
  const user=await currentCloudUser()
  if(!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})
  const {workspaceId}=await context.params
  if(!isUuid(workspaceId)||!await authorizedWorkspace(user,workspaceId,'workspace:update'))
    return NextResponse.json({error:'NOT_FOUND'},{status:404})
  const text=await request.text()
  if(text.length>200000)return NextResponse.json({error:'CONFIG_TOO_LARGE'},{status:413})
  let body:unknown
  try{body=JSON.parse(text)}catch{return NextResponse.json({error:'INVALID_CUSTOMIZATION'},{status:400})}
  if(!body||typeof body!=='object'||Array.isArray(body))
    return NextResponse.json({error:'INVALID_CUSTOMIZATION'},{status:400})
  const req=body as Record<string,unknown>
  const content=readWorkspaceCustomization(req.customization)
  if(!content||!Number.isSafeInteger(req.expectedVersion)||Number(req.expectedVersion)<0)
    return NextResponse.json({error:'INVALID_CUSTOMIZATION'},{status:400})
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR NO KEY UPDATE',[workspaceId])
    const result=await client.query<{version:number}>(
      "SELECT version FROM workspace_settings WHERE workspace_id=$1 AND setting_key='customization' FOR UPDATE",
      [workspaceId])
    const version=result.rows[0]?.version??0
    if(version!==req.expectedVersion){
      await client.query('ROLLBACK')
      return NextResponse.json({error:'VERSION_CONFLICT',actualVersion:version},{status:409})
    }
    const updated=await client.query<{version:number}>(`INSERT INTO workspace_settings
       (workspace_id,setting_key,setting_value,version)
       VALUES($1,'customization',$2::jsonb,1)
       ON CONFLICT (workspace_id,setting_key) DO UPDATE SET
       setting_value=EXCLUDED.setting_value,version=workspace_settings.version+1,updated_at=now()
       RETURNING version`,[workspaceId,JSON.stringify(content)])
    await client.query(`INSERT INTO audit_logs(workspace_id,actor_id,action,target_id,details)
       VALUES($1,$2,'workspace:customization:update',$3,$4::jsonb)`,
      [workspaceId,user.id,workspaceId,JSON.stringify({version:updated.rows[0].version,
        categories:content.categories.length,templates:content.templates.length})])
    await client.query('COMMIT')
    return NextResponse.json({customization:content,version:updated.rows[0].version})
  }catch(error){await client.query('ROLLBACK');throw error}
  finally{client.release()}
}

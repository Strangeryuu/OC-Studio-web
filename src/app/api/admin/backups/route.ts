import {NextResponse} from 'next/server'
import {pool} from '@/lib/cloud/server/db'
import {siteAdminUser} from '@/lib/cloud/server/site-admin'
import {mutationOriginAllowed} from '@/lib/cloud/server/origin'
import {readSiteBackupPolicy,updateSiteBackupPolicy,validateBackupPolicy,listSiteBackupFiles} from '@/lib/cloud/server/site-backups'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(){
  if(!await siteAdminUser())return NextResponse.json({error:'FORBIDDEN'},{status:403})
  const [config,workspaces,files]=await Promise.all([
    readSiteBackupPolicy(),
    pool.query<{id:string;name:string}>(
      'SELECT id,name FROM workspaces WHERE deleted_at IS NULL ORDER BY name LIMIT 501'),
    listSiteBackupFiles(),
  ])
  return NextResponse.json({...config,workspaces:workspaces.rows,files,
    workerConfigured:Boolean(process.env.BACKUP_WORKER_TOKEN&&process.env.BACKUP_WORKER_TOKEN.length>=24)},
    {headers:{'Cache-Control':'private, no-store'}})
}
export async function PUT(request:Request){
  if(!mutationOriginAllowed(request))return NextResponse.json({error:'INVALID_ORIGIN'},{status:403})
  if(!await siteAdminUser())return NextResponse.json({error:'FORBIDDEN'},{status:403})
  const body:unknown=await request.json().catch(()=>null)
  if(!body||typeof body!=='object'||Array.isArray(body))
    return NextResponse.json({error:'INVALID_INPUT'},{status:400})
  const row=body as Record<string,unknown>,policy=validateBackupPolicy(row.policy)
  if(!policy||!Number.isSafeInteger(row.expectedVersion)||(row.expectedVersion as number)<0)
    return NextResponse.json({error:'INVALID_POLICY'},{status:400})
  if(policy.scope==='selected'){
    const valid=await pool.query<{id:string}>(
      'SELECT id FROM workspaces WHERE deleted_at IS NULL AND id=ANY($1::uuid[])',
      [policy.workspaceIds])
    if(valid.rows.length!==policy.workspaceIds.length)
      return NextResponse.json({error:'INVALID_WORKSPACE_SELECTION'},{status:400})
  }
  const saved=await updateSiteBackupPolicy(policy,row.expectedVersion as number)
  return saved?NextResponse.json({saved:true,...saved}):
    NextResponse.json({error:'VERSION_CONFLICT'},{status:409})
}

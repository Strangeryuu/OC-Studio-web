import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { pool } from '@/lib/cloud/server/db'
import { readExpectedVersion } from '@/lib/cloud/entity-input'
import { NOVEL_CATEGORY, MAP_CATEGORY } from '@/lib/entry-kinds'
import { cloudMapAllowed } from '@/lib/cloud/map-fields'
import type { PoolClient } from 'pg'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ workspaceId: string; entityId: string }> }
interface DeletedRow { id: string; local_id: string | number; version: number; title: string; kind: string;
  content: Record<string, unknown>; deleted_at: Date }
const MAX_GROUP = 1000

async function group(client: PoolClient, workspaceId: string, entityId: string) {
  const rows = await client.query<DeletedRow>(`WITH RECURSIVE selected AS (
     SELECT id,local_id,kind,title,content,version,deleted_at
     FROM entities WHERE id=$2 AND workspace_id=$1 AND deleted_at IS NOT NULL
     UNION
     SELECT e.id,e.local_id,e.kind,e.title,e.content,e.version,e.deleted_at
     FROM entities e JOIN selected parent ON
       e.kind='worldEntry' AND parent.kind='worldEntry'
       AND parent.content->>'category'=$3 AND e.content->>'category'=$3
       AND e.content->>'parentId'=parent.local_id::text
       AND e.deleted_at=parent.deleted_at
     WHERE e.workspace_id=$1 AND e.deleted_at IS NOT NULL
   )
   SELECT * FROM selected ORDER BY local_id FOR UPDATE`,[workspaceId,entityId,NOVEL_CATEGORY])
  return rows.rows
}

async function validateAncestors(client: PoolClient, workspaceId: string, rows: DeletedRow[]) {
  const restored = new Set(rows.map(row=>row.id))
  const localIds = new Set(rows.map(row=>String(row.local_id)))
  for (const row of rows) {
    if (row.kind !== 'worldEntry' && row.kind !== 'country') continue
    const parent = row.content.parentId
    if (parent == null) continue
    if (typeof parent !== 'number' || !Number.isSafeInteger(parent)) return false
    if (row.kind === 'worldEntry' && localIds.has(String(parent))) continue
    if (row.kind === 'country' && localIds.has(String(parent))) continue
    const found = await client.query<{ id: string }>(`SELECT id FROM entities WHERE workspace_id=$1 AND kind=$2
      AND local_id=$3 AND deleted_at IS NULL`,[workspaceId,row.kind,parent])
    if (!found.rows.length || restored.has(found.rows[0].id)) return false
  }
  return true
}

async function operate(request: Request, context: Context, permanent: boolean) {
  if (!mutationOriginAllowed(request)) return NextResponse.json({error:'INVALID_ORIGIN'}, {status:403})
  const user=await currentCloudUser()
  if(!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})
  const {workspaceId,entityId}=await context.params
  if(!isUuid(workspaceId)||!isUuid(entityId)||
    !await authorizedWorkspace(user,workspaceId,permanent?'entity:delete':'entity:restore')) {
    return NextResponse.json({error:'NOT_FOUND'},{status:404})
  }
  const raw:unknown=await request.json().catch(()=>null)
  const expected=raw&&typeof raw==='object'&&!Array.isArray(raw)
    ?readExpectedVersion((raw as Record<string,unknown>).expectedVersion):null
  if(expected===null)return NextResponse.json({error:'INVALID_VERSION'},{status:400})
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR NO KEY UPDATE',[workspaceId])
    const rows=await group(client,workspaceId,entityId)
    const root=rows.find(row=>row.id===entityId)
    if(!root){await client.query('ROLLBACK');return NextResponse.json({error:'NOT_FOUND'},{status:404})}
    if(root.version!==expected){await client.query('ROLLBACK');return NextResponse.json({
      error:'VERSION_CONFLICT',actualVersion:root.version},{status:409})}
    if(rows.length>MAX_GROUP){await client.query('ROLLBACK');return NextResponse.json({
      error:'TOO_MANY_ITEMS'},{status:413})}
    if(!permanent){
      if(!await validateAncestors(client,workspaceId,rows)){await client.query('ROLLBACK');return NextResponse.json({
        error:'RESTORE_PARENT_MISSING'},{status:409})}
      for(const row of rows){
        if(row.kind==='worldEntry' && row.content.category===MAP_CATEGORY &&
          !await cloudMapAllowed(client,workspaceId,row.kind,row.content,row.title,row.id)){
          await client.query('ROLLBACK');return NextResponse.json({error:'MAP_NAME_CONFLICT'},{status:409})
        }
      }
    }
    for(const row of rows){
      if(permanent){
        await client.query('DELETE FROM entities WHERE id=$1 AND workspace_id=$2',[row.id,workspaceId])
      }else{
        const nextVersion=row.version+1
        await client.query(`UPDATE entities SET deleted_at=NULL,version=$1,updated_at=now(),updated_by=$2
          WHERE id=$3 AND workspace_id=$4`,[nextVersion,user.id,row.id,workspaceId])
      }
    }
    await client.query(`INSERT INTO audit_logs(workspace_id,actor_id,action,target_id,details)
       VALUES($1,$2,$3,$4,$5::jsonb)`,[workspaceId,user.id,permanent?'trash:purge':'trash:restore',entityId,
       JSON.stringify({count:rows.length,ids:rows.map(row=>row.id)})])
    await client.query('COMMIT')
    return NextResponse.json({restored:!permanent,permanent,items:rows.length})
  }catch(error){
    await client.query('ROLLBACK')
    if(error&&typeof error==='object'&&'code' in error&&error.code==='23505')
      return NextResponse.json({error:'RESTORE_CONFLICT'},{status:409})
    throw error
  }finally{client.release()}
}

export async function POST(request:Request,context:Context){return operate(request,context,false)}
export async function DELETE(request:Request,context:Context){return operate(request,context,true)}

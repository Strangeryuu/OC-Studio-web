import {mkdir,readdir,readFile,rename,stat,unlink,writeFile} from 'node:fs/promises'
import {basename,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {pool} from '@/lib/cloud/server/db'
import {exportWorkspaceBackup} from '@/lib/cloud/server/backup-io'

const POLICY_KEY='site-backup-policy'
const ROOT=process.env.BACKUP_ROOT||'/data/backups'
const LOCK=70411072
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FILENAME=/^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}\.ocbak$/
const FREQUENCIES=[1,6,12,24,72,168,720] as const
export type SiteBackupPolicy={
  enabled:boolean;intervalHours:number;scope:'all'|'selected';workspaceIds:string[];
  keepPerWorkspace:number;lastRunAt:string|null
}
export const DEFAULT_SITE_BACKUP_POLICY:SiteBackupPolicy={
  enabled:false,intervalHours:24,scope:'all',workspaceIds:[],keepPerWorkspace:7,lastRunAt:null,
}
export function validateBackupPolicy(value:unknown):SiteBackupPolicy|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null
  const row=value as Record<string,unknown>
  if(typeof row.enabled!=='boolean'||!FREQUENCIES.some(f=>f===row.intervalHours)||
     (row.scope!=='all'&&row.scope!=='selected')||!Array.isArray(row.workspaceIds)||
     row.workspaceIds.length>200||!row.workspaceIds.every(id=>typeof id==='string'&&UUID.test(id))||
     !Number.isSafeInteger(row.keepPerWorkspace)||(row.keepPerWorkspace as number)<1||
     (row.keepPerWorkspace as number)>30)return null
  const workspaceIds=[...new Set(row.workspaceIds as string[])]
  if(row.scope==='selected'&&workspaceIds.length===0)return null
  return {enabled:row.enabled,intervalHours:row.intervalHours as number,scope:row.scope,
    workspaceIds,keepPerWorkspace:row.keepPerWorkspace as number,
    lastRunAt:typeof row.lastRunAt==='string'&&Number.isFinite(Date.parse(row.lastRunAt))
      ?row.lastRunAt:null}
}
export async function readSiteBackupPolicy(){
  const found=await pool.query<{value:unknown;version:number}>(
    'SELECT value,version FROM site_settings WHERE key=$1',[POLICY_KEY])
  return {policy:validateBackupPolicy(found.rows[0]?.value)??DEFAULT_SITE_BACKUP_POLICY,
    version:found.rows[0]?.version??0}
}
export async function updateSiteBackupPolicy(input:SiteBackupPolicy,expectedVersion:number){
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    const found=await client.query<{version:number}>(
      'SELECT version FROM site_settings WHERE key=$1 FOR UPDATE',[POLICY_KEY])
    if((found.rows[0]?.version??0)!==expectedVersion){
      await client.query('ROLLBACK');return null
    }
    const policy={...input,lastRunAt:null}
    const saved=await client.query<{version:number}>(
      'INSERT INTO site_settings(key,value,version) VALUES($1,$2::jsonb,1) '+
      'ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,'+
      'version=site_settings.version+1,updated_at=now() RETURNING version',
      [POLICY_KEY,JSON.stringify(policy)])
    await client.query('COMMIT')
    return {policy,version:saved.rows[0].version}
  }catch(error){await client.query('ROLLBACK');throw error}
  finally{client.release()}
}
export interface SiteBackupFile{
  workspaceId:string;filename:string;bytes:number;updatedAt:string
}
export async function listSiteBackupFiles(limit=60):Promise<SiteBackupFile[]>{
  let directories:string[]
  try{directories=await readdir(ROOT)}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error}
  const result:SiteBackupFile[]=[]
  for(const workspaceId of directories.slice(0,500)){
    if(!UUID.test(workspaceId))continue
    const folder=join(ROOT,workspaceId)
    let files:string[]
    try{files=await readdir(folder)}catch{continue}
    for(const filename of files.filter(x=>FILENAME.test(x))){
      const data=await stat(join(folder,filename))
      if(data.isFile())result.push({workspaceId,filename,bytes:data.size,
        updatedAt:data.mtime.toISOString()})
    }
  }
  return result.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,limit)
}
export async function readSiteBackupFile(workspaceId:string,filename:string){
  if(!UUID.test(workspaceId)||!FILENAME.test(filename)||basename(filename)!==filename)return null
  try{return await readFile(join(ROOT,workspaceId,filename))}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error}
}
/** Advisory lock prevents simultaneous scheduled/manual backup runs across replicas.
 * Each archive includes a complete workspace and private media for portable restore.
 */
export async function runSiteBackups(force=false){
  const client=await pool.connect()
  let locked=false
  try{
    const row=await client.query<{locked:boolean}>('SELECT pg_try_advisory_lock($1) AS locked',[LOCK])
    locked=row.rows[0]?.locked===true
    if(!locked)return {status:'busy',created:0}
    const {policy,version}=await readSiteBackupPolicy()
    if(!force&&!policy.enabled)return {status:'disabled',created:0}
    if(!force&&policy.lastRunAt&&
       Date.now()-Date.parse(policy.lastRunAt)<policy.intervalHours*3600000)
      return {status:'not_due',created:0}
    const found=await client.query<{id:string;name:string}>(
      'SELECT id,name FROM workspaces WHERE deleted_at IS NULL ORDER BY id LIMIT 501')
    if(found.rows.length>500)throw new Error('BACKUP_WORKSPACE_LIMIT')
    const selected=policy.scope==='all'?found.rows:
      found.rows.filter(x=>policy.workspaceIds.includes(x.id))
    if(policy.scope==='selected'&&selected.length!==policy.workspaceIds.length)
      throw new Error('BACKUP_SELECTED_WORKSPACE_NOT_FOUND')
    let created=0
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')
    for(const workspace of selected){
      const payload=await exportWorkspaceBackup(workspace.id,workspace.name)
      const folder=join(ROOT,workspace.id)
      await mkdir(folder,{recursive:true,mode:0o700})
      const filename=stamp+'-'+randomUUID().slice(0,8)+'.ocbak'
      const staging=join(folder,'.'+filename+'.tmp')
      try{
        await writeFile(staging,payload,{flag:'wx',mode:0o600})
        await rename(staging,join(folder,filename))
      }catch(error){await unlink(staging).catch(()=>undefined);throw error}
      created++
      const names=(await readdir(folder)).filter(x=>FILENAME.test(x)).sort().reverse()
      for(const old of names.slice(policy.keepPerWorkspace))await unlink(join(folder,old))
    }
    await client.query(
      'UPDATE site_settings SET value=jsonb_set(value,\'{lastRunAt}\',$1::jsonb),'+
      'version=version+1,updated_at=now() WHERE key=$2 AND version=$3',
      [JSON.stringify(new Date().toISOString()),POLICY_KEY,version])
    return {status:'completed',created,workspaces:selected.length}
  }finally{
    if(locked)await client.query('SELECT pg_advisory_unlock($1)',[LOCK])
    client.release()
  }
}

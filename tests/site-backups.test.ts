import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest'
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

const fake=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),export:vi.fn()}))
vi.mock('@/lib/cloud/server/db',()=>({pool:{query:fake.query,connect:fake.connect}}))
vi.mock('@/lib/cloud/server/backup-io',()=>({exportWorkspaceBackup:fake.export}))

const one='11111111-1111-4111-8111-111111111111'
const two='22222222-2222-4222-8222-222222222222'
const policy={
  enabled:true,intervalHours:6,scope:'selected' as const,workspaceIds:[one],
  keepPerWorkspace:1,lastRunAt:null as string|null,
}
let root=''
let backup:typeof import('@/lib/cloud/server/site-backups')
let version=1

beforeAll(async()=>{
  root=await mkdtemp(join(tmpdir(),'ocstudio-backups-'))
  process.env.BACKUP_ROOT=root
  backup=await import('@/lib/cloud/server/site-backups')
})
afterAll(async()=>{await rm(root,{recursive:true,force:true});delete process.env.BACKUP_ROOT})
beforeEach(()=>{
  version=1
  policy.lastRunAt=null
  fake.query.mockReset()
  fake.connect.mockReset()
  fake.export.mockReset().mockImplementation(async(id:string)=>JSON.stringify({source:id,complete:true}))
  const query=async(sql:string,args?:unknown[])=>{
    if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]}
    if(sql.includes('pg_advisory_unlock'))return {rows:[{pg_advisory_unlock:true}]}
    if(sql.includes('SELECT value,version FROM site_settings'))
      return {rows:[{value:{...policy},version}]}
    if(sql.includes('SELECT id,name FROM workspaces'))
      return {rows:[{id:one,name:'世界甲'},{id:two,name:'世界乙'}]}
    if(sql.includes('UPDATE site_settings SET value=jsonb_set')){
      if(args?.[2]===version){policy.lastRunAt=JSON.parse(args[0] as string);version++}
      return {rows:[],rowCount:1}
    }
    throw Error('Unexpected SQL: '+sql)
  }
  fake.query.mockImplementation(query)
  fake.connect.mockResolvedValue({query,release:vi.fn()})
})
describe('administrator scheduled workspace backups',()=>{
  it('validates scope, interval and retention without accepting malformed IDs',()=>{
    expect(backup.validateBackupPolicy(policy)).toEqual(policy)
    expect(backup.validateBackupPolicy({...policy,intervalHours:0})).toBeNull()
    expect(backup.validateBackupPolicy({...policy,workspaceIds:['../../etc']})).toBeNull()
    expect(backup.validateBackupPolicy({...policy,workspaceIds:[]})).toBeNull()
    expect(backup.validateBackupPolicy({...policy,keepPerWorkspace:50})).toBeNull()
  })
  it('creates atomic selected-world archives, enforces cadence and retention',async()=>{
    const first=await backup.runSiteBackups()
    expect(first).toMatchObject({status:'completed',created:1,workspaces:1})
    const files=await backup.listSiteBackupFiles()
    expect(files).toHaveLength(1)
    expect(files[0].workspaceId).toBe(one)
    expect(JSON.parse(await readFile(join(root,one,files[0].filename),'utf8')))
      .toEqual({source:one,complete:true})
    expect(await backup.runSiteBackups()).toMatchObject({status:'not_due',created:0})
    expect((await backup.runSiteBackups(true)).created).toBe(1)
    expect((await readdir(join(root,one))).filter(file=>file.endsWith('.ocbak'))).toHaveLength(1)
    expect(await backup.readSiteBackupFile(one,'../../passwd')).toBeNull()
    expect(fake.export).toHaveBeenCalledTimes(2)
    expect(fake.export).not.toHaveBeenCalledWith(two,expect.anything())
  })
})

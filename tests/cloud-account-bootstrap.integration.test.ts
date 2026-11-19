// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
const state=vi.hoisted(()=>({
  db:null as PGlite|null,
  actor:null as {id:string;email:string;name:string;role:string|null}|null,
}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/cloud/server/db',()=>{
  const query=(sql:string,values?:unknown[])=>{
    if(sql.includes('pg_advisory_xact_lock'))return Promise.resolve({rows:[],rowCount:1})
    return state.db!.query(sql,values)
  }
  return {pool:{query,connect:async()=>({query,release:()=>{}})}}
})
vi.mock('@/lib/cloud/server/authorization',()=>({
  currentCloudUser:async()=>state.actor,
  isUuid:(id:unknown)=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id),
}))
import * as setup from '@/app/api/setup/route'
import * as register from '@/app/api/register/route'
import * as invites from '@/app/api/admin/registration-codes/route'
import * as mails from '@/app/api/admin/mail/route'
import { decryptMailPassword } from '@/lib/cloud/server/mailer'
import { isSiteAdmin } from '@/lib/cloud/site-policy'

describe('first-run admin, invite registration and mail settings',()=>{
  beforeAll(async()=>{
    process.env.BETTER_AUTH_URL='http://localhost:3000'
    process.env.BETTER_AUTH_SECRET='ci_account_password_encryption_key_1234567890'
    state.db=new PGlite()
    await state.db.exec(`CREATE TABLE "user"(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,
      "emailVerified" BOOLEAN NOT NULL,"createdAt" TIMESTAMPTZ NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL,role TEXT,banned BOOLEAN DEFAULT false)`)
    await state.db.exec(`CREATE TABLE account(id TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,"providerId" TEXT NOT NULL,"userId" TEXT NOT NULL
      REFERENCES "user"(id),password TEXT,"createdAt" TIMESTAMPTZ,
      "updatedAt" TIMESTAMPTZ)`)
    await state.db.exec(readFileSync('cloud/migrations/0006_site_accounts.sql','utf8'))
  })
  afterAll(async()=>{await state.db?.close()})
  const post=(body:unknown)=>new Request('http://localhost:3000/api/setup',{
    method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},
    body:JSON.stringify(body)})
  it('creates exactly one initial admin and locks setup after success',async()=>{
    expect((await (await setup.GET()).json()).required).toBe(true)
    const form={name:'系统管理员',email:'root@example.test',password:'setup_password_123456789'}
    expect((await setup.POST(post({...form,password:'weak'}))).status).toBe(400)
    expect((await setup.POST(post(form))).status).toBe(201)
    expect((await setup.POST(post(form))).status).toBe(409)
    expect((await (await setup.GET()).json()).required).toBe(false)
    const data=await state.db!.query<{id:string;role:string;email:string}>(
      'SELECT id,role,email FROM "user"')
    expect(data.rows).toHaveLength(1)
    expect(data.rows[0].role).toBe('admin')
    expect(isSiteAdmin(data.rows[0].role)).toBe(true)
    const secret=await state.db!.query<{password:string}>('SELECT password FROM account')
    expect(secret.rows[0].password).not.toContain(form.password)
    state.actor={id:data.rows[0].id,role:'admin',name:'系统管理员',email:'root@example.test'}
  })
  it('generates, consumes and revokes site registration codes with admin-only access',async()=>{
    const create=()=>new Request('http://localhost:3000/api/admin/registration-codes',{
      method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},
      body:JSON.stringify({label:'邀请好友',maxUses:1,expiresDays:7}),
    })
    state.actor=null
    expect((await invites.POST(create())).status).toBe(403)
    state.actor={id:(await state.db!.query<{id:string}>('SELECT id FROM "user"')).rows[0].id,
      name:'admin',role:'admin',email:'root@example.test'}
    const invitation=await invites.POST(create())
    expect(invitation.status).toBe(201)
    const issued=await invitation.json() as {code:string;id:string}
    expect(issued.code).toHaveLength(48)
    const registration=(email:string,inviteCode=issued.code)=>new Request('http://localhost:3000/api/register',{
      method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},
      body:JSON.stringify({name:'受邀成员',email,password:'ordinary_password_123456',confirmPassword:'ordinary_password_123456',inviteCode}),
    })
    expect((await register.POST(registration('new@example.test','wrong'))).status).toBe(400)
    const wrongConfirmation=new Request('http://localhost:3000/api/register',{
      method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},
      body:JSON.stringify({name:'受邀成员',email:'new@example.test',password:'ordinary_password_123456',
        confirmPassword:'different_password_123456',inviteCode:issued.code}),
    })
    expect((await register.POST(wrongConfirmation)).status).toBe(400)
    expect((await register.POST(registration('new@example.test'))).status).toBe(201)
    expect((await register.POST(registration('second@example.test'))).status).toBe(400)
    const members=await state.db!.query<{role:string}>(
      'SELECT role FROM "user" WHERE email=$1',['new@example.test'])
    expect(members.rows[0].role).toBe('user')
    const updated=await state.db!.query<{used_count:number}>(
      'SELECT used_count FROM registration_invites WHERE id=$1',[issued.id])
    expect(updated.rows[0].used_count).toBe(1)
    expect((await invites.GET()).status).toBe(200)
  })
  it('protects mail configuration and encrypts SMTP credentials',async()=>{
    const body={
      mode:'smtp',from:'robot@example.test',host:'smtp.example.test',
      port:587,secure:false,username:'mailer@example.test',password:'testSmtpPass456789!',
    }
    const make=(data:unknown)=>new Request('http://localhost:3000/api/admin/mail',{
      method:'PUT',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},
      body:JSON.stringify(data)})
    state.actor=null
    expect((await mails.PUT(make(body))).status).toBe(403)
    const id=(await state.db!.query<{id:string}>('SELECT id FROM "user" WHERE role=$1',['admin'])).rows[0].id
    state.actor={id,email:'root@example.test',name:'admin',role:'admin'}
    expect((await mails.PUT(make(body))).status).toBe(200)
    const saved=await state.db!.query<{value:{encryptedPassword:string}}>(
      "SELECT value FROM site_settings WHERE key='mail'")
    expect(saved.rows[0].value.encryptedPassword).not.toContain(body.password)
    expect(decryptMailPassword(saved.rows[0].value.encryptedPassword)).toBe(body.password)
    const visible=await (await mails.GET()).json() as {settings:Record<string,unknown>}
    expect(visible.settings.passwordSet).toBe(true)
    expect('encryptedPassword' in visible.settings).toBe(false)
  })
})

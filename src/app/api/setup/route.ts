import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { hashPassword } from 'better-auth/crypto'
import { pool } from '@/lib/cloud/server/db'
import { setupNeeded } from '@/lib/cloud/server/site-admin'
import { validNewAccount } from '@/lib/cloud/site-policy'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(){
  return NextResponse.json({required:await setupNeeded()}, {headers:{'Cache-Control':'no-store'}})
}
export async function POST(request:Request){
  if(!mutationOriginAllowed(request))return NextResponse.json({error:'INVALID_ORIGIN'},{status:403})
  const body:unknown=await request.json().catch(()=>null)
  if(!body||typeof body!=='object'||Array.isArray(body))return NextResponse.json({error:'INVALID_INPUT'},{status:400})
  const {name,email,password}=body as Record<string,unknown>
  if(!validNewAccount(name,email,password))return NextResponse.json({error:'INVALID_INPUT'},{status:400})
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    // Concurrent initial page submissions across multiple containers are serialized.
    await client.query('SELECT pg_advisory_xact_lock(20261120)')
    const [users,settings]=await Promise.all([
      client.query('SELECT 1 FROM "user" LIMIT 1'),
      client.query("SELECT 1 FROM site_settings WHERE key='initialized'"),
    ])
    if(users.rowCount||settings.rowCount){
      await client.query('ROLLBACK')
      return NextResponse.json({error:'ALREADY_INITIALIZED'},{status:409})
    }
    const id=randomUUID()
    const passwordHash=await hashPassword(password as string)
    await client.query(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",role,banned)
      VALUES($1,$2,$3,false,now(),now(),'admin',false)`,
      [id,(name as string).trim(),(email as string).trim().toLowerCase()])
    await client.query(`INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt")
      VALUES($1,$2,'credential',$2,$3,now(),now())`,[randomUUID(),id,passwordHash])
    await client.query("INSERT INTO site_settings(key,value) VALUES('initialized','true'::jsonb)")
    await client.query('COMMIT')
    return NextResponse.json({created:true},{status:201})
  }catch(error){
    await client.query('ROLLBACK')
    if(error&&typeof error==='object'&&'code' in error&&error.code==='23505')
      return NextResponse.json({error:'ALREADY_EXISTS'},{status:409})
    throw error
  }finally{client.release()}
}

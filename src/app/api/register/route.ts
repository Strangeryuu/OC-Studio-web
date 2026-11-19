import { randomUUID,createHash } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { NextResponse } from 'next/server'
import { pool } from '@/lib/cloud/server/db'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { validNewAccount,validInviteCode } from '@/lib/cloud/site-policy'
export const runtime='nodejs'
export async function POST(request:Request){
  if(!mutationOriginAllowed(request))return NextResponse.json({error:'INVALID_ORIGIN'},{status:403})
  const input:unknown=await request.json().catch(()=>null)
  const b=input&&typeof input==='object'&&!Array.isArray(input)?input as Record<string,unknown>:{}
  if(!validNewAccount(b.name,b.email,b.password)||!validInviteCode(b.inviteCode))
    return NextResponse.json({error:'INVALID_REGISTRATION'},{status:400})
  const code=(b.inviteCode as string).trim().toLowerCase()
  const hash=createHash('sha256').update(code).digest()
  const passwordHash=await hashPassword(b.password as string)
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    const initialized=await client.query("SELECT 1 FROM site_settings WHERE key='initialized'")
    const anyAdmin=await client.query("SELECT 1 FROM \"user\" WHERE role LIKE '%admin%' LIMIT 1")
    if(!initialized.rowCount&&!anyAdmin.rowCount){
      await client.query('ROLLBACK')
      return NextResponse.json({error:'SETUP_REQUIRED'},{status:403})
    }
    const result=await client.query<{id:string}>(`SELECT id FROM registration_invites
      WHERE token_sha256=$1 AND revoked_at IS NULL AND expires_at>now()
      AND used_count<max_uses FOR UPDATE`,[hash])
    const invite=result.rows[0]
    if(!invite){
      await client.query('ROLLBACK')
      return NextResponse.json({error:'INVITE_INVALID'},{status:400})
    }
    const id=randomUUID()
    await client.query(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",role,banned)
      VALUES($1,$2,$3,false,now(),now(),'user',false)`,
      [id,(b.name as string).trim(),(b.email as string).trim().toLowerCase()])
    await client.query(`INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt")
      VALUES($1,$2,'credential',$2,$3,now(),now())`,[randomUUID(),id,passwordHash])
    await client.query('UPDATE registration_invites SET used_count=used_count+1 WHERE id=$1',[invite.id])
    await client.query('INSERT INTO registration_redemptions(invite_id,user_id) VALUES($1,$2)',[invite.id,id])
    await client.query('COMMIT')
    return NextResponse.json({created:true},{status:201})
  }catch(error){
    await client.query('ROLLBACK')
    if(error&&typeof error==='object'&&'code' in error&&error.code==='23505')
      return NextResponse.json({error:'EMAIL_ALREADY_USED'},{status:409})
    throw error
  }finally{client.release()}
}

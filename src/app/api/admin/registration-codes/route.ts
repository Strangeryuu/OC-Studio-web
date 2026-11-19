import { createHash,randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { pool } from '@/lib/cloud/server/db'
import { siteAdminUser } from '@/lib/cloud/server/site-admin'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(){
  const user=await siteAdminUser()
  if(!user)return NextResponse.json({error:'FORBIDDEN'},{status:403})
  const result=await pool.query(`SELECT id,label,max_uses,used_count,expires_at,revoked_at,created_at
    FROM registration_invites ORDER BY created_at DESC LIMIT 200`)
  return NextResponse.json({codes:result.rows},{headers:{'Cache-Control':'no-store'}})
}
export async function POST(request:Request){
  if(!mutationOriginAllowed(request))return NextResponse.json({error:'INVALID_ORIGIN'},{status:403})
  const user=await siteAdminUser()
  if(!user)return NextResponse.json({error:'FORBIDDEN'},{status:403})
  const body:unknown=await request.json().catch(()=>null)
  const b=body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:{}
  const days=b.expiresDays===undefined?7:b.expiresDays
  const uses=b.maxUses===undefined?1:b.maxUses
  const label=b.label===undefined?'':b.label
  if(!Number.isSafeInteger(days)||Number(days)<1||Number(days)>90||
    !Number.isSafeInteger(uses)||Number(uses)<1||Number(uses)>100||
    typeof label!=='string'||label.length>100)return NextResponse.json({error:'INVALID_INPUT'},{status:400})
  const code=randomBytes(24).toString('hex')
  const hash=createHash('sha256').update(code).digest()
  const result=await pool.query<{id:string;expires_at:string}>(`INSERT INTO registration_invites(
     token_sha256,label,created_by,expires_at,max_uses)
     VALUES($1,$2,$3,now()+($4::int*interval '1 day'),$5) RETURNING id,expires_at`,
     [hash,label,user.id,days,uses])
  return NextResponse.json({id:result.rows[0].id,code,expiresAt:result.rows[0].expires_at},
    {status:201,headers:{'Cache-Control':'no-store'}})
}

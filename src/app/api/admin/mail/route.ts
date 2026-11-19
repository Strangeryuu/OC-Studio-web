import { NextResponse } from 'next/server'
import { pool } from '@/lib/cloud/server/db'
import { siteAdminUser } from '@/lib/cloud/server/site-admin'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { encryptMailPassword,readMailSettings,validMailSettings } from '@/lib/cloud/server/mailer'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(){
  if(!await siteAdminUser())return NextResponse.json({error:'FORBIDDEN'},{status:403})
  const config=await readMailSettings()
  return NextResponse.json({settings:config?{mode:config.mode,from:config.from,host:config.host,
    port:config.port,secure:config.secure,username:config.username,
    passwordSet:!!config.encryptedPassword}:null},{headers:{'Cache-Control':'no-store'}})
}
export async function PUT(request:Request){
  if(!mutationOriginAllowed(request))return NextResponse.json({error:'INVALID_ORIGIN'},{status:403})
  const user=await siteAdminUser()
  if(!user)return NextResponse.json({error:'FORBIDDEN'},{status:403})
  const body:unknown=await request.json().catch(()=>null)
  if(!body||typeof body!=='object'||Array.isArray(body)||!validMailSettings(body))
    return NextResponse.json({error:'INVALID_MAIL_SETTINGS'},{status:400})
  const input=body as unknown as {
    mode:'local'|'smtp';from:string;host:string;port:number;secure:boolean;username:string;
    password?:unknown
  }
  if(input.password!==undefined&&(typeof input.password!=='string'||input.password.length>500))
    return NextResponse.json({error:'INVALID_MAIL_PASSWORD'},{status:400})
  const old=await readMailSettings()
  const encrypted=input.password?encryptMailPassword(input.password as string):
    old?.encryptedPassword
  if(input.mode==='smtp'&&input.username&&!encrypted)
    return NextResponse.json({error:'SMTP_PASSWORD_REQUIRED'},{status:400})
  const next={mode:input.mode,from:input.from.trim().toLowerCase(),host:input.host.trim(),
    port:input.port,secure:input.secure,username:input.username,
    ...(encrypted?{encryptedPassword:encrypted}:{})}
  await pool.query(`INSERT INTO site_settings(key,value) VALUES('mail',$1::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=site_settings.version+1,updated_at=now()`,
    [JSON.stringify(next)])
  return NextResponse.json({saved:true})
}

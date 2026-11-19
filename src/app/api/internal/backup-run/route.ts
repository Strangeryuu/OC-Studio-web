import {timingSafeEqual,createHash} from 'node:crypto'
import {NextResponse} from 'next/server'
import {runSiteBackups} from '@/lib/cloud/server/site-backups'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:Request){
  const secret=process.env.BACKUP_WORKER_TOKEN
  const token=request.headers.get('authorization')?.replace(/^Bearer /i,'')||''
  if(!secret||secret.length<24||token.length>256)
    return NextResponse.json({error:'NOT_FOUND'},{status:404})
  const hash=(value:string)=>createHash('sha256').update(value).digest()
  if(!timingSafeEqual(hash(secret),hash(token)))
    return NextResponse.json({error:'NOT_FOUND'},{status:404})
  try{return NextResponse.json(await runSiteBackups())}
  catch{return NextResponse.json({error:'BACKUP_FAILED'},{status:500})}
}

import {NextResponse} from 'next/server'
import {mutationOriginAllowed} from '@/lib/cloud/server/origin'
import {siteAdminUser} from '@/lib/cloud/server/site-admin'
import {runSiteBackups} from '@/lib/cloud/server/site-backups'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:Request){
  if(!mutationOriginAllowed(request))return NextResponse.json({error:'INVALID_ORIGIN'},{status:403})
  if(!await siteAdminUser())return NextResponse.json({error:'FORBIDDEN'},{status:403})
  try{return NextResponse.json(await runSiteBackups(true))}
  catch(error){
    const msg=error instanceof Error?error.message:'BACKUP_FAILED'
    return NextResponse.json({error:/^BACKUP_[A-Z_]+$/.test(msg)?msg:'BACKUP_FAILED'},{status:500})
  }
}

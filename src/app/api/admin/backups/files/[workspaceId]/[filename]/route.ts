import {NextResponse} from 'next/server'
import {siteAdminUser} from '@/lib/cloud/server/site-admin'
import {readSiteBackupFile} from '@/lib/cloud/server/site-backups'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(_request:Request,{params}:{
  params:Promise<{workspaceId:string;filename:string}>
}){
  if(!await siteAdminUser())return NextResponse.json({error:'FORBIDDEN'},{status:403})
  const {workspaceId,filename}=await params
  const bytes=await readSiteBackupFile(workspaceId,filename)
  if(!bytes)return NextResponse.json({error:'NOT_FOUND'},{status:404})
  return new Response(new Uint8Array(bytes),{headers:{
    'Content-Type':'application/octet-stream',
    'Content-Disposition':'attachment; filename="'+filename+'"',
    'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store',
  }})
}

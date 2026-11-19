import { NextResponse } from 'next/server'
import { siteAdminUser } from '@/lib/cloud/server/site-admin'
import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { pool } from '@/lib/cloud/server/db'
import { isUuid } from '@/lib/cloud/server/authorization'
export const runtime='nodejs'
export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){
  if(!mutationOriginAllowed(request))return NextResponse.json({error:'INVALID_ORIGIN'},{status:403})
  const user=await siteAdminUser()
  if(!user)return NextResponse.json({error:'FORBIDDEN'},{status:403})
  const {id}=await context.params
  if(!isUuid(id))return NextResponse.json({error:'NOT_FOUND'},{status:404})
  const result=await pool.query(`UPDATE registration_invites SET revoked_at=now()
    WHERE id=$1 AND revoked_at IS NULL RETURNING id`,[id])
  if(!result.rowCount)return NextResponse.json({error:'NOT_FOUND'},{status:404})
  return NextResponse.json({revoked:true})
}

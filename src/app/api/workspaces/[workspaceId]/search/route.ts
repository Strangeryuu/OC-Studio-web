import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { indexCloudWorkspaceSearch, type CloudSearchRecord } from '@/lib/cloud/workspace-search'
import { searchTerms } from '@/lib/search/matcher'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(request:Request,context:{params:Promise<{workspaceId:string}>}){
  const user=await currentCloudUser()
  if(!user)return NextResponse.json({error:'UNAUTHORIZED'},{status:401})
  const {workspaceId}=await context.params
  if(!isUuid(workspaceId)||!await authorizedWorkspace(user,workspaceId,'entity:read'))
    return NextResponse.json({error:'NOT_FOUND'},{status:404})
  const query=new URL(request.url).searchParams.get('q')??''
  const terms=searchTerms(query)
  if(query.length>120||terms.length>8)
    return NextResponse.json({error:'INVALID_QUERY'},{status:400})
  if(terms.length===0)return NextResponse.json({hits:[],truncated:false})
  // Filter to the current workspace before applying the original ranking.
  // Escaped LIKE tokens keep % and _ literal; bound the index scan.
  const params:unknown[]=[workspaceId]
  const where=terms.map(term=>{
    params.push('%'+term.replace(/[\\%_]/g,match=>'\\'+match)+'%')
    return '(title ILIKE $'+params.length+" ESCAPE '\\' OR content::text ILIKE $"+
      params.length+" ESCAPE '\\')"
  })
  const result=await pool.query<CloudSearchRecord>(`SELECT id,local_id,kind,title,content
    FROM entities WHERE workspace_id=$1 AND deleted_at IS NULL
      AND (${where.join(' AND ')})
    ORDER BY updated_at DESC LIMIT 1501`,params)
  const hits=indexCloudWorkspaceSearch(result.rows.slice(0,1500),query)
  return NextResponse.json({hits:hits.slice(0,80),truncated:result.rows.length>1500||hits.length>80},
    {headers:{'Cache-Control':'private, no-store'}})
}

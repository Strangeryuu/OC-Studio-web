import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { CategoryArchive } from '@/lib/cloud/category-archive'

/**
 * A signed, short-lived snapshot prevents overwrites using a stale preview
 * and binds the user's explicit confirmation to its exact archive bytes,
 * destination world and entity versions. No database schema changes required.
 */
const TTL_MS=15*60*1000
export interface CategoryTargetSnapshot {
  sourceKey:string
  targetId:string|null
  version:number|null
}
interface Ticket {
  kind:'category-overwrite-preview-v1'
  workspaceId:string
  actorId:string
  archiveHash:string
  targetHash:string
  issuedAt:number
  expiresAt:number
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sorted=(items:CategoryTargetSnapshot[])=>[...items].sort(
  (a,b)=>a.sourceKey.localeCompare(b.sourceKey,'en'))
function key():string {
  const secret=process.env.BETTER_AUTH_SECRET
  if(!secret||secret.length<32)throw new Error('CATEGORY_PREVIEW_UNAVAILABLE')
  return secret
}
function sign(data:string):Buffer {
  return createHmac('sha256',key()).update(data,'utf8').digest()
}
const invalid=():never=>{throw new Error('CATEGORY_PREVIEW_INVALID')}

export function issueCategoryOverwritePreview(input:{
  archive:CategoryArchive
  workspaceId:string
  actorId:string
  targets:CategoryTargetSnapshot[]
  now?:number
}):string {
  const issuedAt=input.now??Date.now()
  const body:Ticket={
    kind:'category-overwrite-preview-v1',
    workspaceId:input.workspaceId,actorId:input.actorId,
    archiveHash:hash(input.archive),
    targetHash:hash(sorted(input.targets)),
    issuedAt,expiresAt:issuedAt+TTL_MS,
  }
  const data=Buffer.from(JSON.stringify(body)).toString('base64url')
  return data+'.'+sign(data).toString('base64url')
}

export function verifyCategoryOverwritePreview(input:{
  token:unknown
  archive:CategoryArchive
  workspaceId:string
  actorId:string
  targets:CategoryTargetSnapshot[]
  now?:number
}):void {
  const token=input.token
  if(typeof token!=='string'||token.length>1500||!token.includes('.'))invalid()
  const parts=token.split('.')
  if(parts.length!==2||!parts[0]||!parts[1])invalid()
  let provided:Buffer
  try {provided=Buffer.from(parts[1],'base64url')}
  catch {invalid()}
  const expected=sign(parts[0])
  if(provided.length!==expected.length||!timingSafeEqual(provided,expected))invalid()
  let decoded:unknown
  try {decoded=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8')) as unknown}
  catch {invalid()}
  if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))invalid()
  const body=decoded as Record<string,unknown>
  if(body.kind!=='category-overwrite-preview-v1'||
    body.workspaceId!==input.workspaceId||body.actorId!==input.actorId||
    typeof body.issuedAt!=='number'||typeof body.expiresAt!=='number'||
    !Number.isSafeInteger(body.issuedAt)||!Number.isSafeInteger(body.expiresAt)||
    body.expiresAt-body.issuedAt!==TTL_MS)invalid()
  const now=input.now??Date.now()
  if(now<body.issuedAt||now>body.expiresAt)
    throw new Error('CATEGORY_PREVIEW_EXPIRED')
  if(body.archiveHash!==hash(input.archive)||
     body.targetHash!==hash(sorted(input.targets)))
    throw new Error('CATEGORY_PREVIEW_STALE')
}

import { NextResponse } from 'next/server'
import { pool } from '@/lib/cloud/server/db'
import { isUuid } from '@/lib/cloud/server/authorization'
import { validShareToken, shareTokenDigest } from '@/lib/cloud/server/public-share'
import { readPrivateImage } from '@/lib/cloud/server/media-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ token: string; assetId: string }> }
const noStore = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }

export async function GET(_request: Request, context: Context) {
  const { token, assetId } = await context.params
  if (!validShareToken(token) || !isUuid(assetId)) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers: noStore })
  }
  // Scope media to the specific shared workspace. Never fall through to the
  // authenticated /api/media endpoint (or to a different public share).
  const result = await pool.query<{ storage_key: string; mime_type: string }>(
    `SELECT a.storage_key,a.mime_type FROM media_assets a
     JOIN workspace_public_shares s ON s.workspace_id=a.workspace_id
     JOIN workspaces w ON w.id=s.workspace_id
     WHERE a.id=$1 AND a.deleted_at IS NULL AND
       s.token_sha256=$2 AND s.revoked_at IS NULL AND w.deleted_at IS NULL
     LIMIT 1`, [assetId, shareTokenDigest(token)])
  const asset = result.rows[0]
  if (!asset) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers: noStore })
  try {
    const bytes = await readPrivateImage(asset.storage_key)
    return new Response(Uint8Array.from(bytes).buffer, { status: 200, headers: {
      ...noStore, 'Content-Type': asset.mime_type,
      'Content-Length': String(bytes.byteLength), 'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    } })
  } catch {
    return NextResponse.json({ error: 'MEDIA_UNAVAILABLE' }, { status: 404, headers: noStore })
  }
}

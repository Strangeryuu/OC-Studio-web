import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace, isUuid } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { readPrivateImage } from '@/lib/cloud/server/media-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { assetId } = await context.params
  if (!isUuid(assetId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  const result = await pool.query<{ workspace_id: string; storage_key: string; mime_type: string }>(
    `SELECT workspace_id,storage_key,mime_type FROM media_assets
     WHERE id=$1 AND deleted_at IS NULL`, [assetId],
  )
  const asset = result.rows[0]
  if (!asset || !await authorizedWorkspace(user, asset.workspace_id, 'media:read')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  try {
    const bytes = await readPrivateImage(asset.storage_key)
    return new Response(Uint8Array.from(bytes).buffer, {
      status: 200,
      headers: {
        'Content-Type': asset.mime_type,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ error: 'MEDIA_UNAVAILABLE' }, { status: 404 })
  }
}

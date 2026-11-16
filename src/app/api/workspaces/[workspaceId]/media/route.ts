import { mutationOriginAllowed } from '@/lib/cloud/server/origin'
import { NextResponse } from 'next/server'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { MAX_UPLOAD_BYTES } from '@/lib/cloud/image-types'
import { writePrivateImage, removePrivateImage } from '@/lib/cloud/server/media-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  if (!mutationOriginAllowed(request)) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 })
  const user = await currentCloudUser()
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  const { workspaceId } = await context.params
  if (!await authorizedWorkspace(user, workspaceId, 'media:upload')) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const claimedSize = Number(request.headers.get('content-length'))
  if (Number.isFinite(claimedSize) && claimedSize > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 413 })
  }
  const form = await request.formData().catch(() => null)
  const value = form?.get('file')
  if (!(value instanceof File) || value.size <= 0 || value.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'INVALID_FILE' }, { status: 400 })
  }
  const bytes = new Uint8Array(await value.arrayBuffer())
  let saved: Awaited<ReturnType<typeof writePrivateImage>>
  try {
    saved = await writePrivateImage(workspaceId, bytes)
  } catch (error) {
    if (error instanceof Error && error.message === 'UNSUPPORTED_IMAGE') {
      return NextResponse.json({ error: 'UNSUPPORTED_IMAGE' }, { status: 415 })
    }
    throw error
  }
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO media_assets (workspace_id,uploaded_by,storage_key,mime_type,byte_size,content_sha256)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [workspaceId, user.id, saved.storageKey, saved.kind.mime, saved.size, saved.sha256],
    )
    const asset = { id: result.rows[0].id, url: '/api/media/' + result.rows[0].id }
    return NextResponse.json({ asset }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    await removePrivateImage(saved.storageKey).catch(() => {})
    throw error
  }
}

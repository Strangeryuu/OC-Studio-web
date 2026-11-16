import 'server-only'
import { isAbsolute, join } from 'node:path'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { detectAllowedImage, MAX_UPLOAD_BYTES, type AllowedImage } from '@/lib/cloud/image-types'

function storageRoot(): string {
  const root = process.env.MEDIA_ROOT
  if (!root || !isAbsolute(root)) throw new Error('MEDIA_ROOT must be an absolute private server directory')
  return root
}

const SAFE_KEY = /^[0-9a-f-]{36}[/][0-9a-f-]{36}[.](png|jpg|gif|webp)$/i

export async function writePrivateImage(workspaceId: string, data: Uint8Array): Promise<{
  storageKey: string
  kind: AllowedImage
  size: number
  sha256: string
}> {
  const kind = data.byteLength <= MAX_UPLOAD_BYTES && data.byteLength >= 12
    ? detectAllowedImage(data) : null
  if (!kind) throw new Error('UNSUPPORTED_IMAGE')
  const filename = randomUUID() + '.' + kind.extension
  const root = storageRoot()
  await mkdir(join(root, workspaceId), { recursive: true, mode: 0o700 })
  const storageKey = workspaceId + '/' + filename
  const bytes = Buffer.from(data)
  await writeFile(join(root, storageKey), bytes, { flag: 'wx', mode: 0o600 })
  return { storageKey, kind, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
}

export async function readPrivateImage(storageKey: string): Promise<Uint8Array> {
  if (!SAFE_KEY.test(storageKey)) throw new Error('INVALID_STORAGE_KEY')
  return new Uint8Array(await readFile(join(storageRoot(), storageKey)))
}

export async function removePrivateImage(storageKey: string): Promise<void> {
  if (!SAFE_KEY.test(storageKey)) throw new Error('INVALID_STORAGE_KEY')
  await unlink(join(storageRoot(), storageKey))
}

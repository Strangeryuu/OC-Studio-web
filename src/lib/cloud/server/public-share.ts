import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { pool } from './db'

export const SHARE_TOKEN_PATTERN = /^[a-f0-9]{64}$/
export function validShareToken(value: unknown): value is string {
  return typeof value === 'string' && SHARE_TOKEN_PATTERN.test(value)
}
export function newShareToken(): string {
  return randomBytes(32).toString('hex')
}
export function shareTokenDigest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}
function key(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret || secret.length < 32) throw Error('SHARE_ENCRYPTION_SECRET_MISSING')
  return scryptSync(secret, 'oc-studio-share-token-v1', 32)
}
export function encryptShareToken(token: string): string {
  if (!validShareToken(token)) throw Error('INVALID_SHARE_TOKEN')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const bytes = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64')
}
export function decryptShareToken(ciphertext: string): string {
  const bytes = Buffer.from(ciphertext, 'base64')
  if (bytes.length < 28) throw Error('INVALID_SHARE_CIPHERTEXT')
  const decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12))
  decipher.setAuthTag(bytes.subarray(12, 28))
  const token = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
  if (!validShareToken(token)) throw Error('INVALID_SHARE_TOKEN')
  return token
}
export interface SharedWorkspace { id: string; name: string; description: string | null }
/** Revalidate token/revocation/soft deletion from PostgreSQL on EVERY public request. */
export async function sharedWorkspace(token: string): Promise<SharedWorkspace | null> {
  if (!validShareToken(token)) return null
  const found = await pool.query<SharedWorkspace>(
    `SELECT w.id,w.name,w.description FROM workspace_public_shares s
     JOIN workspaces w ON w.id=s.workspace_id
     WHERE s.token_sha256=$1 AND s.revoked_at IS NULL AND w.deleted_at IS NULL
     LIMIT 1`, [shareTokenDigest(token)])
  return found.rows[0] ?? null
}
/** Rewrite only private OC Studio image URLs, never grant general media access. */
export function shareMediaUrl(token: string, source: string): string {
  if (!validShareToken(token)) return source
  return source.replace(/\/api\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b/gi,
    (_match, assetId: string) => '/api/public-shares/' + token + '/media/' + assetId.toLowerCase())
}
export function shareImageUrl(token: string, source: unknown): string | null {
  if (typeof source !== 'string') return null
  const url = shareMediaUrl(token, source)
  if (url.startsWith('/api/public-shares/' + token + '/media/')) return url
  // Remote images remain author-specified public URLs (no auth cookies attached).
  if (/^https:\/\/[^\s"'<>]+$/i.test(url)) return url
  return null
}

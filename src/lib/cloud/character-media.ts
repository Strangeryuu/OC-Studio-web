/** Pure validation for media identifiers used inside cloud character JSON.
 * The owning-workspace check is performed in the server database.
 */
import { collectBodyImageRefs } from '@/lib/image-refs'
import { readStoredBody } from '@/lib/body-content'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function cloudMediaUrlId(value: string): string | null {
  const prefix = '/api/media/'
  const id = value.startsWith(prefix) ? value.slice(prefix.length) : ''
  return UUID_RE.test(id) ? id.toLowerCase() : null
}

export function characterMediaIds(kind: unknown, content: unknown): string[] | null {
  if (kind !== 'character') return []
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null
  const record = content as Record<string, unknown>
  const ids: string[] = []
  for (const src of collectBodyImageRefs(readStoredBody(record.document))) {
    const id = cloudMediaUrlId(src)
    if (id) ids.push(id)
  }
  for (const key of ['avatarMediaId', 'headerMediaId']) {
    const value = record[key]
    if (value === undefined || value === null || value === '') continue
    if (typeof value !== 'string' || !UUID_RE.test(value)) return null
    ids.push(value)
  }
  const arrays: Record<string, number> = { portraitMediaIds: 24, galleryMediaIds: 48 }
  for (const [key, max] of Object.entries(arrays)) {
    const raw = record[key]
    if (raw === undefined) continue
    if (!Array.isArray(raw) || raw.length > max) return null
    if (!raw.every(item => typeof item === 'string' && UUID_RE.test(item))) return null
    if (new Set(raw).size !== raw.length) return null
    ids.push(...raw)
  }
  const cloudTags = record.cloudTags
  if (cloudTags !== undefined) {
    if (!Array.isArray(cloudTags) || cloudTags.length > 30 ||
      cloudTags.some(item => typeof item !== 'string' ||
        item.trim().length < 1 || item.trim().length > 40)) return null
    if (new Set(cloudTags.map(item => item.trim().toLocaleLowerCase('zh-CN'))).size !== cloudTags.length) return null
  }
  return [...new Set(ids)]
}

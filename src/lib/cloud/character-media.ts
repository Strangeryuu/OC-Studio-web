/** Pure validation for media identifiers used inside original entity JSON.
 * The owning-workspace check is performed in the server database.
 */
import { collectBodyImageRefs } from '@/lib/image-refs'
import { worldBodyOf } from '@/lib/world-body'
import { readStoredBody } from '@/lib/body-content'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function cloudMediaUrlId(value: string): string | null {
  const prefix = '/api/media/'
  const id = value.startsWith(prefix) ? value.slice(prefix.length) : ''
  return UUID_RE.test(id) ? id.toLowerCase() : null
}

export function characterMediaIds(kind: unknown, content: unknown): string[] | null {
  if (kind !== 'character' && kind !== 'country' && kind !== 'event' && kind !== 'worldEntry') return []
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null
  const record = content as Record<string, unknown>
  const ids: string[] = []
  const coverKeys = kind === 'worldEntry' ? ['cover', 'avatar', 'image', 'mapImage']
    : kind === 'country' ? ['flagUrl', 'headerUrl']
    : kind === 'character' ? ['avatarUrl', 'headerUrl'] : ['headerUrl']
  for (const key of coverKeys) {
    const value = record[key]
    if (typeof value !== 'string' || !value.startsWith('/api/media/')) continue
    const id = cloudMediaUrlId(value)
    if (id === null) return null
    ids.push(id)
  }
  if (kind === 'worldEntry' && record.mapViews != null) {
    if (typeof record.mapViews !== 'object' || Array.isArray(record.mapViews)) return null
    const views = Object.entries(record.mapViews)
    if (views.length > 6) return null
    for (const [key, url] of views) {
      if (!['terrain','contour','temperature','moisture','biome','political'].includes(key) ||
        typeof url !== 'string' || cloudMediaUrlId(url) === null) return null
      ids.push(cloudMediaUrlId(url)!)
    }
  }
  const galleryKeys = kind === 'character' ? ['avatars', 'gallery'] : kind === 'event' ? ['images'] : ['gallery']
  for (const key of galleryKeys) {
    const images = record[key]
    if (!Array.isArray(images)) continue
    for (const item of images) {
      const value = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as Record<string, unknown>).url : undefined
      if (typeof value !== 'string' || !value.startsWith('/api/media/')) continue
      const id = cloudMediaUrlId(value)
      if (id === null) return null
      ids.push(id)
    }
  }
  const doc = kind === 'worldEntry'
    ? worldBodyOf({ document: record.document, content: typeof record.content === 'string' ? record.content : undefined })
    : readStoredBody(record.document)
  for (const src of collectBodyImageRefs(doc)) {
    if (!src.startsWith('/api/media/')) continue
    const id = cloudMediaUrlId(src)
    if (id === null) return null
    ids.push(id)
  }
  if (kind !== 'character') return [...new Set(ids)]
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

export function hasNewBodyImages(original: unknown, next: unknown): boolean {
  const originalImages = new Set(collectBodyImageRefs(readStoredBody(original)))
  return collectBodyImageRefs(next).some(src => !originalImages.has(src) && cloudMediaUrlId(src) === null)
}

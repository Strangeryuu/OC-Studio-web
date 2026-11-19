/** Exact URL reference rewriting for one cloud media asset.
 * Keeps unrelated text/URLs intact and supports TipTap JSON stored as strings.
 */
export interface MediaRewriteResult<T = unknown> { value: T; references: number }
const REMOVED = Symbol('removed-image')
type Walk = { value: unknown | typeof REMOVED; references: number }

export function rewriteMediaReferences<T>(input: T, oldUrl: string, nextUrl: string | null): MediaRewriteResult<T> {
  if (!oldUrl.startsWith('/api/media/') || nextUrl === oldUrl) return { value: input, references: 0 }
  const originalId = oldUrl.slice('/api/media/'.length)
  const replacementId = nextUrl?.startsWith('/api/media/') ? nextUrl.slice('/api/media/'.length) : null
  function visit(value: unknown, arrayChild = false): Walk {
    if (typeof value === 'string') {
      if (value === oldUrl) return { value: nextUrl ?? (arrayChild ? REMOVED : ''), references: 1 }
      if (value.includes(oldUrl) && (value[0] === '{' || value[0] === '[')) {
        try {
          const parsed: unknown = JSON.parse(value)
          if (parsed && typeof parsed === 'object') {
            const converted = visit(parsed)
            if (converted.references) return {
              value: JSON.stringify(converted.value), references: converted.references,
            }
          }
        } catch { /* Regular user text stays untouched. */ }
      }
      return { value, references: 0 }
    }
    if (Array.isArray(value)) {
      let references = 0
      const values: unknown[] = []
      for (const item of value) {
        const result = visit(item, true)
        references += result.references
        if (result.value !== REMOVED) values.push(result.value)
      }
      return references ? { value: values, references } : { value, references: 0 }
    }
    if (!value || typeof value !== 'object') return { value, references: 0 }
    const row = value as Record<string, unknown>
    const attrs = row.attrs
    if (nextUrl === null && (row.type === 'imageBlock' || row.type === 'image') &&
        attrs && typeof attrs === 'object' && (attrs as Record<string, unknown>).src === oldUrl) {
      return { value: REMOVED, references: 1 }
    }
    if (nextUrl === null && arrayChild && row.url === oldUrl) {
      return { value: REMOVED, references: 1 }
    }
    let references = 0
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(row)) {
      // Earlier cloud character records also persisted separate media UUIDs.
      // Keep them consistent with the public URL fields so future edits pass
      // the same-workspace media ownership checks after an asset is removed.
      if ((key === 'avatarMediaId' || key === 'headerMediaId') && item === originalId) {
        result[key] = replacementId
        references += 1
        continue
      }
      if ((key === 'portraitMediaIds' || key === 'galleryMediaIds') && Array.isArray(item)) {
        const matches = item.filter(value => value === originalId).length
        if (matches) {
          result[key] = item.flatMap(value =>
            value !== originalId ? [value] : replacementId ? [replacementId] : [])
          references += matches
          continue
        }
      }
      // Map views store one media URL per named layer. Empty URLs violate the
      // validated mapViews schema, so remove the affected layer altogether.
      if (key === 'mapViews' && nextUrl === null &&
          item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const views = item as Record<string, unknown>
        const matched = Object.values(views).filter(url => url === oldUrl).length
        if (matched) {
          const kept = Object.fromEntries(Object.entries(views).filter(([,url]) => url !== oldUrl))
          result[key] = Object.keys(kept).length ? kept : null
          references += matched
          continue
        }
      }
      const rewritten = visit(item)
      references += rewritten.references
      result[key] = rewritten.value === REMOVED ? '' : rewritten.value
    }
    return references ? { value: result, references } : { value, references: 0 }
  }
  const result = visit(input)
  return { value: result.value as T, references: result.references }
}

import type { JSONContent } from '@tiptap/core'

/** Cloud editing keeps unknown original OC Studio fields intact. */
export interface CloudCharacterFields {
  name: string
  bio: string
  race: string
  element: string
  occupation: string
  faction: string
  height: string
  birthday: string
  aliases: string[]
  country: string
  isMajor: boolean
  custom: Record<string, string>
  avatarMediaId: string | null
  headerMediaId: string | null
  portraitMediaIds: string[]
  galleryMediaIds: string[]
  /** Text tags for the cloud bridge; original numeric tag ids stay untouched. */
  cloudTags: string[]
  document: JSONContent
}

const EMPTY_DOCUMENT: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
export function cloudMediaList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string =>
    typeof item === 'string' && item.length > 0 && item.length <= 128))].slice(0, max)
}

export function cloudTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const tags: string[] = []
  const seen = new Set<string>()
  for (const valueItem of value) {
    if (typeof valueItem !== 'string') continue
    const trimmed = valueItem.trim()
    const normalized = trimmed.toLocaleLowerCase('zh-CN')
    if (!trimmed || trimmed.length > 40 || seen.has(normalized)) continue
    seen.add(normalized)
    tags.push(trimmed)
    if (tags.length >= 30) break
  }
  return tags
}

function validDocument(value: unknown): value is JSONContent {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (value as Record<string, unknown>).type === 'doc' &&
    Array.isArray((value as Record<string, unknown>).content)
}

export function cloudCharacterFields(content: Record<string, unknown>, title: string): CloudCharacterFields {
  return {
    name: safeString(content.name) || title,
    bio: safeString(content.bio),
    race: safeString(content.race),
    element: safeString(content.element),
    occupation: safeString(content.occupation),
    faction: safeString(content.faction),
    height: safeString(content.height),
    birthday: safeString(content.birthday),
    aliases: Array.isArray(content.aliases) ? content.aliases.filter((v): v is string => typeof v === 'string') : [],
    country: safeString(content.country) || safeString(content.nationalityLegacy),
    isMajor: content.isMajor === true,
    custom: Object.fromEntries(Object.entries(
      content.custom && typeof content.custom === 'object' && !Array.isArray(content.custom)
        ? content.custom as Record<string, unknown> : {},
    ).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    avatarMediaId: safeString(content.avatarMediaId) || null,
    headerMediaId: safeString(content.headerMediaId) || null,
    portraitMediaIds: cloudMediaList(content.portraitMediaIds, 24),
    galleryMediaIds: cloudMediaList(content.galleryMediaIds, 48),
    cloudTags: cloudTagList(content.cloudTags),
    document: validDocument(content.document) ? content.document : EMPTY_DOCUMENT,
  }
}

export function mergeCloudCharacter(
  original: Record<string, unknown>,
  next: CloudCharacterFields,
): Record<string, unknown> {
  return {
    ...original,
    ...next,
    name: next.name.trim(),
    aliases: [...next.aliases],
    avatarMediaId: next.avatarMediaId,
    headerMediaId: next.headerMediaId,
    portraitMediaIds: cloudMediaList(next.portraitMediaIds, 24),
    galleryMediaIds: cloudMediaList(next.galleryMediaIds, 48),
    cloudTags: cloudTagList(next.cloudTags),
    // Keep values from pre-existing custom fields which this editor does not expose.
    custom: {
      ...(original.custom && typeof original.custom === 'object' && !Array.isArray(original.custom)
        ? original.custom as Record<string, unknown> : {}),
      ...next.custom,
    },
    document: structuredClone(next.document),
  }
}

export function cloudCharacterHasChanges(
  originalTitle: string, originalData: Record<string, unknown>,
  next: CloudCharacterFields,
): boolean {
  const nextData = mergeCloudCharacter(originalData, next)
  if (originalTitle !== next.name.trim()) return true
  return JSON.stringify(nextData) !== JSON.stringify(originalData)
}

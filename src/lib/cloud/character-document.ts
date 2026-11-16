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
  avatarMediaId: string | null
  document: JSONContent
}

const EMPTY_DOCUMENT: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
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
    avatarMediaId: safeString(content.avatarMediaId) || null,
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

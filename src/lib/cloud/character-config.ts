/**
 * Cloud schema for the upstream OC Studio character field registry and template.
 * This code uses ONLY the pure default definitions. Do not import the original
 * Dexie/vault stores into the cloud path; those stores are browser-global.
 */
import { BUILTIN_FIELDS } from '@/lib/fields/defaults'
import { builtinTemplate } from '@/lib/templates/defaults'
import type { FieldDef } from '@/lib/fields/types'

export const CLOUD_CHARACTER_COMPONENTS = ['avatar', 'info', 'summary', 'body'] as const
export type CloudCharacterComponentId = typeof CLOUD_CHARACTER_COMPONENTS[number]
export type CloudCharacterComponent = { id: CloudCharacterComponentId; enabled: boolean }
export interface CloudCharacterConfig {
  fields: FieldDef[]
  components: CloudCharacterComponent[]
}

const supported = new Set<string>(CLOUD_CHARACTER_COMPONENTS)
const reserved = new Set(['__proto__', 'constructor', 'prototype'])
const characterBuiltins = new Map(BUILTIN_FIELDS.character.map(field => [field.id, field]))

export function defaultCloudCharacterConfig(): CloudCharacterConfig {
  return {
    fields: BUILTIN_FIELDS.character.map(field => ({ ...field })),
    components: builtinTemplate('character').components
      .filter(component => supported.has(component.id))
      .map(component => ({
        id: component.id as CloudCharacterComponentId,
        enabled: true,
      })),
  }
}

export function validCustomFieldKey(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 && value.length <= 64 &&
    /^[\p{L}\p{N}_-]+$/u.test(value) &&
    !reserved.has(value.toLowerCase()) &&
    !characterBuiltins.has(value) &&
    !['name', 'bio', 'document', 'custom', 'avatarMediaId', 'aliases', 'gallery', 'id'].includes(value)
}

/** Return null for invalid updates; never silently replace invalid DB configs. */
export function parseCloudCharacterConfig(input: unknown): CloudCharacterConfig | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  if (!Array.isArray(record.fields) || !Array.isArray(record.components) ||
    record.fields.length > 60 || record.components.length !== CLOUD_CHARACTER_COMPONENTS.length) return null

  const fields: FieldDef[] = []
  const seenIds = new Set<string>()
  const seenKeys = new Set<string>()
  for (const item of record.fields) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const field = item as Record<string, unknown>
    if (typeof field.id !== 'string' || seenIds.has(field.id) ||
      typeof field.label !== 'string' || !field.label.trim() || field.label.length > 60) return null
    seenIds.add(field.id)
    const builtin = characterBuiltins.get(field.id)
    if (builtin) {
      if (field.type !== builtin.type || field.key !== undefined) return null
      fields.push({ ...builtin, label: field.label.trim() })
    } else {
      if (!/^f_[a-z0-9_-]{1,48}$/i.test(field.id) ||
        field.type !== 'text' || !validCustomFieldKey(field.key)) return null
      if (seenKeys.has(field.key)) return null
      seenKeys.add(field.key)
      fields.push({ id: field.id, key: field.key, label: field.label.trim(), type: 'text' })
    }
  }

  const seenComponents = new Set<string>()
  const components: CloudCharacterComponent[] = []
  for (const item of record.components) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const component = item as Record<string, unknown>
    if (typeof component.id !== 'string' || !supported.has(component.id) ||
      seenComponents.has(component.id) || typeof component.enabled !== 'boolean') return null
    seenComponents.add(component.id)
    if (component.id === 'body' && !component.enabled) return null
    components.push({ id: component.id as CloudCharacterComponentId, enabled: component.enabled })
  }
  if (seenComponents.size !== CLOUD_CHARACTER_COMPONENTS.length) return null
  return { fields, components }
}

export function moveInList<T>(input: readonly T[], index: number, shift: number): T[] {
  const copy = [...input]
  const destination = index + shift
  if (index < 0 || destination < 0 || index >= copy.length || destination >= copy.length) return copy
  const [value] = copy.splice(index, 1)
  copy.splice(destination, 0, value)
  return copy
}

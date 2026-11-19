/** Versioned character ability and elemental affinity configuration.
 * Saved inside Character.custom for compatibility with both original vault and cloud JSON.
 */
export const CHARACTER_ATTRIBUTES_KEY = '__ocstudio_character_attributes_v1'

export const STAT_DEFINITIONS = [
  { key: 'strength', label: '力量' },
  { key: 'defense', label: '防御' },
  { key: 'constitution', label: '体质' },
  { key: 'spirit', label: '精神' },
  { key: 'speed', label: '速度' },
  { key: 'luck', label: '幸运' },
] as const

export type StatKey = typeof STAT_DEFINITIONS[number]['key']
export const GRADES = ['S', 'A', 'B', 'C', 'D', 'E', 'F'] as const
export type Grade = typeof GRADES[number]
export const GRADE_LEVEL: Record<Grade, number> = {
  S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1,
}

export const STAT_COLORS = [
  { name: '珊瑚红', hex: '#E86B68' },
  { name: '橙金', hex: '#E4A545' },
  { name: '明黄', hex: '#E9C941' },
  { name: '草绿', hex: '#59BA69' },
  { name: '青绿', hex: '#39BAA1' },
  { name: '湖蓝', hex: '#4C9ED6' },
  { name: '紫罗兰', hex: '#9879D4' },
  { name: '樱粉', hex: '#D779A9' },
  { name: '银灰', hex: '#818C9A' },
  { name: '墨色', hex: '#414856' },
] as const

export const AFFINITY_DEFINITIONS = [
  { key: 'fire', label: '火', hex: '#FF0000' },
  { key: 'earth', label: '土', hex: '#FFC400' },
  { key: 'wood', label: '木', hex: '#00EB00' },
  { key: 'water', label: '水', hex: '#0066CC' },
  { key: 'wind', label: '风', hex: '#00FF80' },
  { key: 'electric', label: '电', hex: '#00FFFF' },
  { key: 'light', label: '光', hex: '#FFFFFF' },
  { key: 'dark', label: '暗', hex: '#000000' },
  { key: 'ether', label: '以太', hex: '#7F00FF' },
  { key: 'physical', label: '物理', hex: '#808080' },
] as const

export type AffinityKey = typeof AFFINITY_DEFINITIONS[number]['key']
export type CharacterAttributes = {
  version: 1
  stats: Record<StatKey, Grade | null>
  color: string
  affinities: Record<AffinityKey, number>
}

export function defaultCharacterAttributes(): CharacterAttributes {
  return {
    version: 1,
    stats: {
      strength: null, defense: null, constitution: null,
      spirit: null, speed: null, luck: null,
    },
    color: STAT_COLORS[5].hex,
    affinities: {
      fire: 0, earth: 0, wood: 0, water: 0, wind: 0,
      electric: 0, light: 0, dark: 0, ether: 0, physical: 0,
    },
  }
}

/** Validate old or malformed saved content before displaying and editing. */
export function parseCharacterAttributes(value: unknown): CharacterAttributes {
  const result = defaultCharacterAttributes()
  if (typeof value !== 'string' || value.length > 8192) return result
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return result }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result
  const data = parsed as Record<string, unknown>
  if (typeof data.color === 'string' && STAT_COLORS.some(color => color.hex === data.color))
    result.color = data.color
  const stats = data.stats && typeof data.stats === 'object' && !Array.isArray(data.stats)
    ? data.stats as Record<string, unknown> : {}
  for (const { key } of STAT_DEFINITIONS) {
    if (typeof stats[key] === 'string' && GRADES.some(grade => grade === stats[key]))
      result.stats[key] = stats[key] as Grade
  }
  const affinities = data.affinities && typeof data.affinities === 'object' && !Array.isArray(data.affinities)
    ? data.affinities as Record<string, unknown> : {}
  for (const { key } of AFFINITY_DEFINITIONS) {
    const rating = affinities[key]
    if (typeof rating === 'number' && Number.isInteger(rating) && rating >= 0 && rating <= 7)
      result.affinities[key] = rating
  }
  return result
}

export function serializeCharacterAttributes(attributes: CharacterAttributes): string {
  return JSON.stringify(attributes)
}

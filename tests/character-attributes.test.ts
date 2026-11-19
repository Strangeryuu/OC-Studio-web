import { describe, expect, it } from 'vitest'
import {
  AFFINITY_DEFINITIONS, CHARACTER_ATTRIBUTES_KEY, GRADE_LEVEL, GRADES, STAT_COLORS,
  defaultCharacterAttributes, parseCharacterAttributes, serializeCharacterAttributes,
} from '@/lib/character-attributes'

describe('OC character six-stat panel and attribute affinities', () => {
  it('has S to F radar levels and ten specified affinity colors', () => {
    expect(GRADES).toEqual(['S', 'A', 'B', 'C', 'D', 'E', 'F'])
    expect(GRADE_LEVEL).toEqual({ S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 })
    expect(AFFINITY_DEFINITIONS.map(({ label, hex }) => [label, hex])).toEqual([
      ['火','#FF0000'], ['土','#FFC400'], ['木','#00EB00'], ['水','#0066CC'],
      ['风','#00FF80'], ['电','#00FFFF'], ['光','#FFFFFF'], ['暗','#000000'],
      ['以太','#7F00FF'], ['物理','#808080'],
    ])
  })
  it('roundtrips user choices through a single versioned custom field', () => {
    const value = defaultCharacterAttributes()
    value.stats.strength = 'S'
    value.stats.luck = 'F'
    value.affinities.fire = 7
    value.affinities.ether = 4
    value.color = STAT_COLORS[0].hex
    const custom = { unrelated: 'kept', [CHARACTER_ATTRIBUTES_KEY]: serializeCharacterAttributes(value) }
    expect(parseCharacterAttributes(custom[CHARACTER_ATTRIBUTES_KEY])).toEqual(value)
    expect(custom.unrelated).toBe('kept')
  })
  it('uses safe defaults for bad input, invalid grade/color or ratings outside 0-7', () => {
    expect(parseCharacterAttributes('{not-json')).toEqual(defaultCharacterAttributes())
    const result = parseCharacterAttributes(JSON.stringify({
      stats: { strength: 'Z', speed: 'A' },
      color: 'javascript:alert(1)',
      affinities: { fire: 9, light: -1, wind: 3.5, earth: 6 },
    }))
    expect(result.stats.strength).toBeNull()
    expect(result.stats.speed).toBe('A')
    expect(result.color).toBe(defaultCharacterAttributes().color)
    expect(result.affinities.fire).toBe(0)
    expect(result.affinities.earth).toBe(6)
  })
})

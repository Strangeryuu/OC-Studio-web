import { describe, expect, it } from 'vitest'
import {
  defaultCloudCharacterConfig, parseCloudCharacterConfig, moveInList, validCustomFieldKey,
} from '@/lib/cloud/character-config'

describe('original OC Studio character defaults in cloud', () => {
  it('reuses original character field definitions and component ordering', () => {
    const config = defaultCloudCharacterConfig()
    expect(config.fields.map(field => field.id)).toEqual([
      'aliases', 'race', 'element', 'occupation', 'faction', 'country',
      'height', 'birthday', 'isMajor',
    ])
    expect(config.components.map(component => component.id)).toEqual([
      'cover', 'avatar', 'info', 'portrait', 'tags', 'gallery', 'summary', 'body',
    ])
    expect(parseCloudCharacterConfig(config)).toEqual(config)
  })


  it('upgrades legacy four-block workspace settings without unexpectedly showing new sections', () => {
    const full = defaultCloudCharacterConfig()
    const old = {
      fields: full.fields,
      components: [
        { id: 'summary', enabled: false },
        { id: 'info', enabled: true },
        { id: 'avatar', enabled: true },
        { id: 'body', enabled: true },
      ],
    }
    const upgraded = parseCloudCharacterConfig(old)
    expect(upgraded?.components.filter(c => ['summary', 'info', 'avatar', 'body'].includes(c.id))
      .map(c => ({ id: c.id, enabled: c.enabled }))).toEqual(old.components)
    expect(upgraded?.components.filter(c => ['cover', 'portrait', 'gallery', 'tags'].includes(c.id))
      .every(c => c.enabled === false)).toBe(true)
    expect(upgraded?.components).toHaveLength(8)
  })

  it('supports ordered, renamed and hidden builtins without dropping data', () => {
    const config = defaultCloudCharacterConfig()
    config.fields = [{ ...config.fields[1], label: '物种' }, config.fields[0]]
    config.components[1].enabled = false
    const valid = parseCloudCharacterConfig(config)
    expect(valid?.fields[0].label).toBe('物种')
    expect(valid?.components[1].enabled).toBe(false)
  })

  it('permits custom Unicode field keys while rejecting dangerous keys', () => {
    expect(validCustomFieldKey('能力设定')).toBe(true)
    for (const key of ['__proto__', 'constructor', 'prototype', 'name', 'document', 'x.y', '']) {
      expect(validCustomFieldKey(key)).toBe(false)
    }
    const config = defaultCloudCharacterConfig()
    config.fields.push({ id: 'f_ability', label: '能力', type: 'text', key: '能力设定' })
    expect(parseCloudCharacterConfig(config)?.fields.at(-1)?.key).toBe('能力设定')
    config.fields.push({ id: 'f_dupe', label: '重复', type: 'text', key: '能力设定' })
    expect(parseCloudCharacterConfig(config)).toBeNull()
  })

  it('rejects forged fields, duplicate entries and missing body component', () => {
    const config = defaultCloudCharacterConfig()
    expect(parseCloudCharacterConfig({ ...config, fields: [{ id: 'isMajor', label: 'x', type: 'text' }] })).toBeNull()
    expect(parseCloudCharacterConfig({ ...config, fields: [...config.fields, config.fields[0]] })).toBeNull()
    expect(parseCloudCharacterConfig({
      ...config, components: config.components.map(c => c.id === 'body' ? { ...c, enabled: false } : c),
    })).toBeNull()
    expect(parseCloudCharacterConfig({
      ...config, components: [...config.components, { id: 'animation', enabled: true }],
    })).toBeNull()
  })

  it('moves fields and blocks without mutating source arrays', () => {
    const input = ['a', 'b', 'c']
    expect(moveInList(input, 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveInList(input, 0, -1)).toEqual(input)
    expect(input).toEqual(['a', 'b', 'c'])
  })
})

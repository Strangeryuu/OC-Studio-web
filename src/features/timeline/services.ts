import { db } from '@/lib/db'
import { logOperation, pendingStamp } from '@/lib/sync'
import { notifyDataUpdated } from '@/lib/data-events'
import { getFieldConfig } from '@/lib/fields/store'
import type { FieldDef } from '@/lib/fields/types'
import type { Character, Country, Event } from '@/types'
import type { TimelineEvent } from './types'
import { pickTimelineFields } from './types'

export interface TimelineFilter {
  characterId?: number
  countryId?: number
}

function parseYear(time: string): number | null {
  if (!time) return null
  const match = /^-?\d+/.exec(time)
  return match ? parseInt(match[0], 10) : null
}

/**
 * 国家时间节点的 id 命名空间。
 *
 * 事件 id 是正数，出生节点是 `-characterId`；国家节点用一段远离它们的负数，
 * 三者在同一张时间线里不会撞。真正的分发看 `kind`，不靠 id 符号猜。
 */
export const COUNTRY_NODE_BASE = -1_000_000_000

/**
 * 国家时间字段 → 时间线节点（纯函数，脚本可断言）。
 *
 * 只收**年份能读出来**的值：`''` / `不详` 这类自由文本不上时间线，
 * 和角色生日的口径一致（`getBirthNodes`）。
 */
export function buildCountryTimelineNodes(
  countries: Country[],
  fields: FieldDef[],
): TimelineEvent[] {
  const timeFields = fields.filter(
    (field) => field.type === 'time' && typeof field.key === 'string' && field.key !== '',
  )
  if (timeFields.length === 0) return []

  const nodes: TimelineEvent[] = []
  for (const country of countries) {
    for (const [index, field] of timeFields.entries()) {
      const key = field.key as string
      const time = country.custom?.[key] ?? ''
      if (parseYear(time) === null) continue
      nodes.push({
        id: COUNTRY_NODE_BASE - country.id * 1000 - index,
        title: `${country.name} · ${field.label}`,
        time,
        summary: field.label,
        isMajor: true,
        kind: 'country',
        countryId: country.id,
        countryField: field.label,
      })
    }
  }
  return nodes
}

export async function getTimelineEvents(filter?: TimelineFilter): Promise<TimelineEvent[]> {
  const [events, characters, countries] = await Promise.all([
    db.events.orderBy('time').toArray(),
    filter?.countryId === undefined ? db.characters.toArray() : [],
    filter?.characterId === undefined ? db.countries.toArray() : [],
  ])
  return buildTimelineEvents(events, characters, countries, getFieldConfig().country, filter)
}

export function buildTimelineEvents(
  entities: Event[],
  characters: Character[],
  countries: Country[],
  countryFields: FieldDef[],
  filter?: TimelineFilter,
): TimelineEvent[] {
  let alive = entities.filter(event => !event.deleted)

  if (filter?.characterId !== undefined) {
    alive = alive.filter(
      (e) => Array.isArray(e.characters) && e.characters.includes(filter.characterId!),
    )
  }
  if (filter?.countryId !== undefined) {
    alive = alive.filter(
      (e) => e.countries !== undefined && e.countries.includes(filter.countryId!),
    )
  }

  const withTime = alive.filter((e) => !!e.time)
  const withoutTime = alive.filter((e) => !e.time)

  withTime.sort((a, b) => {
    const aYear = parseYear(a.time) ?? 0
    const bYear = parseYear(b.time) ?? 0
    if (aYear !== bYear) return aYear - bYear
    return a.time.localeCompare(b.time)
  })

  const events: TimelineEvent[] = [
    ...withTime.map(pickTimelineFields),
    ...withoutTime.map(pickTimelineFields),
  ]

  const births = filter?.countryId !== undefined ? [] : characters
    .filter(character => !character.deleted && parseYear(character.birthday) !== null)
    .filter(character => filter?.characterId === undefined || character.id === filter.characterId)
    .map((character): TimelineEvent => ({
      id: -character.id,
      title: `${character.name}出生`,
      time: character.birthday,
      summary: character.birthday,
      isMajor: true,
      kind: 'birth',
      characterId: character.id,
    }))
  const countryNodes = filter?.characterId !== undefined ? [] : buildCountryTimelineNodes(
    countries.filter(country => !country.deleted && (filter?.countryId === undefined || country.id === filter.countryId)),
    countryFields,
  )
  return [...events, ...births, ...countryNodes].sort((a, b) => {
    const aYear = parseYear(a.time) ?? 0
    const bYear = parseYear(b.time) ?? 0
    return aYear - bYear
  })
}

export async function updateEventTime(
  id: number,
  newTime: string,
  newEndTime?: string,
): Promise<void> {
  const now = Date.now()
  const existing = await db.events.get(id)
  if (!existing) {
    throw new Error(`Event not found: ${id}`)
  }

  const oldTime = existing.time
  await db.events.update(id, {
    time: newTime,
    endTime: newEndTime,
    updatedAt: now,
    ...pendingStamp(now),
  } as Partial<Event>)

  await logOperation('events', id, 'time', oldTime, newTime)
  notifyDataUpdated()
}

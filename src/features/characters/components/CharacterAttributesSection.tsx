'use client'

import { Star } from 'lucide-react'
import type { CharacterForm } from '../hooks/useCharacterForm'
import {
  AFFINITY_DEFINITIONS, CHARACTER_ATTRIBUTES_KEY, GRADE_LEVEL, GRADES,
  STAT_COLORS, STAT_DEFINITIONS, parseCharacterAttributes, serializeCharacterAttributes,
  type CharacterAttributes, type AffinityKey, type StatKey,
} from '@/lib/character-attributes'

const SVG_CENTER = 170
const SVG_RADIUS = 112

function point(index: number, radius: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + index * Math.PI / 3
  return {
    x: SVG_CENTER + Math.cos(angle) * radius,
    y: SVG_CENTER + Math.sin(angle) * radius,
  }
}

function hexPoints(radius: number): string {
  return STAT_DEFINITIONS.map((_, index) => {
    const current = point(index, radius)
    return String(current.x) + ',' + String(current.y)
  }).join(' ')
}

function abilityPoints(attributes: CharacterAttributes): string {
  return STAT_DEFINITIONS.map((definition, index) => {
    const grade = attributes.stats[definition.key]
    const current = point(index, grade ? SVG_RADIUS * GRADE_LEVEL[grade] / 7 : 0)
    return String(current.x) + ',' + String(current.y)
  }).join(' ')
}

function CharacterRadar({ attributes }: { attributes: CharacterAttributes }) {
  const hasRating = STAT_DEFINITIONS.some(definition => attributes.stats[definition.key])
  return <svg className="mx-auto block w-full max-w-[23rem]" viewBox="0 0 340 340"
    role="img" aria-label="角色六维能力六边形雷达图，外圈S级，内圈F级">
    {([...GRADES].reverse()).map((grade) =>
      <polygon key={grade} points={hexPoints(SVG_RADIUS * GRADE_LEVEL[grade] / 7)}
        fill="none" stroke="currentColor" strokeWidth={grade === 'S' ? 1.5 : 1}
        className="text-ink-faint" opacity={grade === 'S' ? 0.72 : 0.38} />)}
    {STAT_DEFINITIONS.map((definition, index) => {
      const destination = point(index, SVG_RADIUS)
      return <line key={definition.key} x1={SVG_CENTER} y1={SVG_CENTER}
        x2={destination.x} y2={destination.y}
        stroke="currentColor" strokeWidth="1" className="text-ink-faint" opacity=".5" />
    })}
    {hasRating && <>
      <polygon points={abilityPoints(attributes)} fill={attributes.color}
        fillOpacity=".3" stroke={attributes.color} strokeWidth="3" strokeLinejoin="round" />
      {STAT_DEFINITIONS.map((definition, index) => {
        const grade = attributes.stats[definition.key]
        if (!grade) return null
        const position = point(index, SVG_RADIUS * GRADE_LEVEL[grade] / 7)
        return <circle key={definition.key} cx={position.x} cy={position.y} r="4"
          stroke="var(--oc-paper)" strokeWidth="1.5" fill={attributes.color} />
      })}
    </>}
    {GRADES.map(grade =>
      <text key={grade} x={SVG_CENTER + 9}
        y={SVG_CENTER - SVG_RADIUS * GRADE_LEVEL[grade] / 7 + 4}
        fontSize="10" fill="currentColor" className="text-ink-muted">{grade}</text>)}
    {STAT_DEFINITIONS.map((definition, index) => {
      const destination = point(index, SVG_RADIUS + 33)
      return <text key={definition.key} x={destination.x} y={destination.y + 5}
        textAnchor="middle" fontSize="13" fontWeight="600" fill="currentColor"
        className="text-ink">{definition.label}</text>
    })}
  </svg>
}

export function CharacterAttributesSection({ form }: { form: CharacterForm }) {
  const attributes = parseCharacterAttributes(form.custom[CHARACTER_ATTRIBUTES_KEY])
  function save(next: CharacterAttributes) {
    form.setCustomValue(CHARACTER_ATTRIBUTES_KEY, serializeCharacterAttributes(next))
  }
  function updateStat(key: StatKey, grade: CharacterAttributes['stats'][StatKey]) {
    save({ ...attributes, stats: { ...attributes.stats, [key]: grade } })
  }
  function updateAffinity(key: AffinityKey, count: number) {
    save({ ...attributes, affinities: { ...attributes.affinities, [key]: count } })
  }

  return <div className="flex min-w-0 flex-col gap-5">
    <section className="min-w-0 rounded-panel border border-line bg-paper-card p-4 sm:p-5"
      aria-labelledby="character-abilities-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="character-abilities-heading" className="text-ui font-semibold text-ink">角色能力面板</h3>
          <p className="mt-1 text-caption text-ink-muted">六维评定 · 从外圈 S 到内圈 F · 选择等级后自动绘制</p>
        </div>
        <span className="rounded-full border border-line px-2 py-1 text-caption text-ink-muted">
          {STAT_DEFINITIONS.filter(item => attributes.stats[item.key] !== null).length} / 6 已填写
        </span>
      </div>
      <CharacterRadar attributes={attributes} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {STAT_DEFINITIONS.map(item =>
          <label key={item.key} className="flex min-w-0 flex-col gap-1.5 text-caption text-ink-muted">
            {item.label}
            <select aria-label={item.label + '等级'} className="h-9 w-full rounded-control border border-line bg-paper px-2 text-ui text-ink outline-none focus:border-ink-muted"
              value={attributes.stats[item.key] ?? ''}
              onChange={event => updateStat(item.key, event.target.value
                ? event.target.value as CharacterAttributes['stats'][StatKey] : null)}>
              <option value="">未设置</option>
              {GRADES.map(grade => <option key={grade} value={grade}>{grade} 级</option>)}
            </select>
          </label>)}
      </div>
      <div className="mt-4 flex flex-col gap-2 border-t border-line pt-3">
        <span className="text-caption text-ink-muted">能力图填充色</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="选择六边形能力图填充色">
          {STAT_COLORS.map(color => <button key={color.hex} type="button"
            aria-label={'使用' + color.name + '填充能力图'} aria-pressed={attributes.color === color.hex}
            onClick={() => save({ ...attributes, color: color.hex })}
            title={color.name}
            className={'flex h-8 w-8 items-center justify-center rounded-full border transition-transform hover:scale-110 ' +
              (attributes.color === color.hex ? 'border-ink outline outline-1 outline-ink' : 'border-paper')}
            style={{ backgroundColor: color.hex }}>
            {attributes.color === color.hex && <span aria-hidden="true" className="text-sm font-bold text-white"
              style={{ textShadow: '0 1px 3px black' }}>✓</span>}
          </button>)}
        </div>
      </div>
    </section>

    <section className="min-w-0 rounded-panel border border-line bg-paper-card p-4 sm:p-5"
      aria-labelledby="character-affinities-heading">
      <h3 id="character-affinities-heading" className="text-ui font-semibold text-ink">角色属性亲和度</h3>
      <p className="mt-1 text-caption text-ink-muted">每项最多七星 · 点击星星设定亲和度 · 再次点击当前星数可清零</p>
      <div className="mt-4 grid grid-cols-1 gap-x-5 gap-y-3 lg:grid-cols-2">
        {AFFINITY_DEFINITIONS.map(affinity => {
          const value = attributes.affinities[affinity.key]
          return <div key={affinity.key}
            className="flex min-w-0 items-center gap-1.5 rounded-item border border-line/60 bg-paper px-2 py-2">
            <span className="w-8 shrink-0 text-ui font-semibold" style={{
              color: affinity.hex,
              textShadow: affinity.key === 'light' ? '0 0 2px gray'
                : affinity.key === 'dark' ? '0 0 2px white' : undefined,
            }}>{affinity.label}</span>
            <div className="flex min-w-0 flex-1 items-center justify-between gap-0.5" role="group"
              aria-label={affinity.label + '亲和度，当前' + value + '星'}>
              {Array.from({ length: 7 }, (_, index) => {
                const count = index + 1
                const active = count <= value
                const light = affinity.key === 'light'
                const dark = affinity.key === 'dark'
                const outline = active
                  ? light ? 'gray' : dark ? 'dimgray' : affinity.hex
                  : 'var(--oc-ink-faint)'
                return <button key={count} type="button"
                  aria-label={affinity.label + '亲和度' + count + '星'}
                  aria-pressed={active}
                  title={affinity.label + ' ' + count + ' / 7'}
                  className="inline-flex h-7 min-w-0 flex-1 items-center justify-center rounded-control transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
                  onClick={() => updateAffinity(affinity.key, value === count ? 0 : count)}>
                  <Star size={20} strokeWidth={active ? 2 : 1.6}
                    stroke={outline} fill={active ? affinity.hex : 'transparent'}
                    style={{ filter: active ? 'drop-shadow(0 0 1px gray)' : undefined }} />
                </button>
              })}
            </div>
            <span className="w-8 shrink-0 text-right text-caption tabular-nums text-ink-muted">{value}/7</span>
          </div>
        })}
      </div>
    </section>
  </div>
}

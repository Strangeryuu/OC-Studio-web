import { PERIOD_COLORS, type Period } from '@/types'
import { parseYear } from '@/features/events/utils'

export interface PeriodFields {
  name: string
  startTime: string
  endTime: string
  color: string
}
export const MAX_CLOUD_PERIODS = 500
const colors = new Set<string>(PERIOD_COLORS.map(x => x.value))
const obj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

function validTime(v: unknown): v is string {
  if (typeof v !== 'string' || !/^-?\d{1,6}(?:-\d{1,2}(?:-\d{1,2})?)?$/.test(v)) return false
  if (parseYear(v) === null) return false
  const parts = v.replace(/^-/, '').split('-')
  const month = Number(parts[1] ?? 1), day = Number(parts[2] ?? 1)
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
}
export function readPeriodFields(v: unknown): PeriodFields | null {
  if (!obj(v) || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 120 ||
      !validTime(v.startTime) || !validTime(v.endTime) || !colors.has(String(v.color)))
    return null
  const sortKey = (date: string) => {
    const p = date.replace(/^-/, '').split('-')
    return [parseYear(date)!, Number(p[1] ?? 1), Number(p[2] ?? 1)]
  }
  const a = sortKey(v.startTime), b = sortKey(v.endTime)
  if (a[0] > b[0] ||
      (a[0] === b[0] && (a[1] > b[1] ||
        (a[1] === b[1] && a[2] > b[2])))) return null
  return { name: v.name.trim(), startTime: v.startTime, endTime: v.endTime, color: v.color as string }
}
export function readWorkspacePeriods(value: unknown): Period[] | null {
  if (!Array.isArray(value) || value.length > 3000) return null
  const ids = new Set<number>(), periods: Period[] = []
  for (const item of value) {
    if (!obj(item) || !Number.isSafeInteger(item.id) || Number(item.id) <= 0 ||
        ids.has(Number(item.id))) return null
    ids.add(Number(item.id))
    if (item.deleted === true) continue
    const fields = readPeriodFields(item)
    if (!fields) return null
    periods.push({ id: item.id as number, ...fields })
    if (periods.length > MAX_CLOUD_PERIODS) return null
  }
  return periods.sort((a, b) =>
    (parseYear(a.startTime) ?? 0) - (parseYear(b.startTime) ?? 0) || a.id - b.id)
}

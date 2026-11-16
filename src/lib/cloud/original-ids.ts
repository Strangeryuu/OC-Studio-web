/** Parse a server-issued entity ID or pagination cursor without losing precision. */
export function parseOriginalId(value: unknown, allowZero = false): number | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) return null
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < (allowZero ? 0 : 1)) return null
  return id
}

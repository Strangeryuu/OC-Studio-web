export interface CloudWorkspaceTag {
  id: string
  name: string
  color: string
}
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/

export function parseWorkspaceTag(value: unknown): { name: string; color: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const fields = value as Record<string, unknown>
  if (typeof fields.name !== 'string' || typeof fields.color !== 'string') return null
  const name = fields.name.trim()
  if (!name || name.length > 40 || !COLOR_RE.test(fields.color)) return null
  return { name, color: fields.color.toLowerCase() }
}

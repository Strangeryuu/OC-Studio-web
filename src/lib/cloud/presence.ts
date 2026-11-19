/** A presence scope identifies one editable workspace panel, including custom categories. */
export function validPresenceScope(scope: unknown): scope is string {
  return typeof scope === 'string' && (
    ['home', 'character', 'country', 'event', 'world', 'novel', 'map', 'table', 'relations'].includes(scope) ||
    /^category:cat-[a-zA-Z0-9-]{1,80}$/.test(scope)
  )
}
export const PRESENCE_TTL_SECONDS = 45

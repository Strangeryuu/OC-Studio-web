/** A presence scope identifies one editable workspace panel, including custom categories. */
export function validPresenceScope(scope: unknown): scope is string {
  return typeof scope === 'string' && (
    ['home', 'character', 'country', 'event', 'world', 'novel', 'map', 'table', 'relations'].includes(scope) ||
    /^category:cat-[a-zA-Z0-9-]{1,80}$/.test(scope) ||
    /^(character|country|event|world|category):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scope)
  )
}
export const PRESENCE_TTL_SECONDS = 45

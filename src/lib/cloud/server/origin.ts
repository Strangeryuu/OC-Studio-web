import 'server-only'

/** Custom cookie-authenticated mutating APIs require a same-origin browser request.
 * BETTER_AUTH_URL must be the canonical public origin (including local dev port).
 */
export function mutationOriginAllowed(request: Request, baseUrl = process.env.BETTER_AUTH_URL): boolean {
  const origin = request.headers.get('Origin')
  if (!origin || !baseUrl) return false
  try {
    return new URL(origin).origin === new URL(baseUrl).origin
  } catch {
    return false
  }
}

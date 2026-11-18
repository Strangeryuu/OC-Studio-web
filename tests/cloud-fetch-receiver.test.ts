import { afterEach, describe, expect, it, vi } from 'vitest'
import { OriginalCharactersCloudAdapter } from '@/lib/cloud/adapters/original-characters'
import { OriginalCountriesCloudAdapter } from '@/lib/cloud/adapters/original-countries'
import { OriginalEventsCloudAdapter } from '@/lib/cloud/adapters/original-events'
import { OriginalNotesCloudAdapter } from '@/lib/cloud/adapters/original-notes'

const workspaceId = '11111111-1111-4111-8111-111111111111'

afterEach(() => vi.unstubAllGlobals())

describe('cloud adapters preserve native Window.fetch receiver', () => {
  it('loads all original entity kinds through default browser fetch without illegal invocation', async () => {
    const request = vi.fn(function(this: unknown, input: RequestInfo | URL) {
      if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")
      expect(String(input)).toContain('/api/workspaces/' + workspaceId + '/legacy-entities?kind=')
      return Promise.resolve(new Response(JSON.stringify({ entities: [], nextCursor: null }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }))
    })
    vi.stubGlobal('fetch', request)
    const adapters = [
      new OriginalCharactersCloudAdapter(workspaceId),
      new OriginalCountriesCloudAdapter(workspaceId),
      new OriginalEventsCloudAdapter(workspaceId),
      new OriginalNotesCloudAdapter(workspaceId),
    ]
    for (const adapter of adapters) expect(await adapter.list()).toEqual([])
    expect(request).toHaveBeenCalledTimes(4)
  })

  it('keeps explicit fetch injection for PostgreSQL and integration test clients', async () => {
    const customFetch = vi.fn(async () => new Response(JSON.stringify({ entities: [], nextCursor: null })))
    expect(await new OriginalCharactersCloudAdapter(workspaceId, customFetch).list()).toEqual([])
    expect(customFetch).toHaveBeenCalledOnce()
  })
})

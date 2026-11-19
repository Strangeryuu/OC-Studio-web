// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const state = vi.hoisted(() => ({
  db: null as PGlite | null,
  user: { id: 'ci-editor' } as { id: string } | null,
  role: 'editor' as 'editor' | 'viewer' | null,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/cloud/server/db', () => {
  const query = (sql: string, values?: unknown[]) => state.db!.query(sql, values)
  return { pool: { query, connect: async () => ({ query, release: () => {} }) } }
})
vi.mock('@/lib/cloud/server/authorization', () => ({
  currentCloudUser: async () => state.user,
  isUuid: (id: unknown) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id),
  authorizedWorkspace: async (_user: unknown, _workspace: string, action: string) =>
    action === 'entity:update' && state.role === 'editor' ? 'editor' : null,
}))
vi.mock('@/lib/cloud/server/origin', () => ({
  mutationOriginAllowed: (request: Request) => request.headers.get('origin') === 'http://localhost:3000',
}))

import * as api from '@/app/api/workspaces/[workspaceId]/graph-layout/route'

const workspaceId = '660e8400-e29b-41d4-a716-446655440001'
const otherId = '660e8400-e29b-41d4-a716-446655440002'
const character = '550e8400-e29b-41d4-a716-446655440001'
const country = '550e8400-e29b-41d4-a716-446655440002'
const foreign = '550e8400-e29b-41d4-a716-446655440003'
const context = { params: Promise.resolve({ workspaceId }) }
const a = { id: character, entityType: 'character', localId: 1, expectedVersion: 1, x: 23, y: 40 }
const b = { id: country, entityType: 'country', localId: 2, expectedVersion: 1, x: -10, y: 81 }
function post(positions: unknown, origin = 'http://localhost:3000') {
  return api.POST(new Request('http://localhost:3000/api/workspaces/' + workspaceId + '/graph-layout', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions }),
  }), context)
}
async function versions() {
  const result = await state.db!.query<{ id: string; version: number; content: { graphPosition?: { x: number; y: number } } }>(
    'SELECT id,version,content FROM entities WHERE workspace_id=$1 ORDER BY id', [workspaceId])
  return result.rows
}

describe('atomic PostgreSQL graph relayout and undo', () => {
  beforeAll(async () => {
    state.db = new PGlite()
    await state.db.exec(
      'CREATE TABLE workspaces (id UUID PRIMARY KEY,deleted_at TIMESTAMPTZ);' +
      'CREATE TABLE entities (id UUID PRIMARY KEY,workspace_id UUID NOT NULL REFERENCES workspaces(id),' +
      'local_id BIGINT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,content JSONB NOT NULL,' +
      'version INTEGER NOT NULL,updated_by TEXT,updated_at TIMESTAMPTZ DEFAULT now(),' +
      'deleted_at TIMESTAMPTZ);' +
      'CREATE TABLE entity_revisions (entity_id UUID,version INTEGER,actor_id TEXT,action TEXT,' +
      'summary TEXT,content_snapshot JSONB);' +
      'CREATE TABLE change_events (entity_id UUID,version INTEGER,actor_id TEXT,action TEXT,' +
      'changes JSONB);' +
      'CREATE TABLE audit_logs (workspace_id UUID,actor_id TEXT,action TEXT,target_id TEXT,' +
      'details JSONB);',
    )
    await state.db.query('INSERT INTO workspaces(id) VALUES($1),($2)', [workspaceId, otherId])
    for (const [id, ws, localId, kind] of [
      [character, workspaceId, 1, 'character'],
      [country, workspaceId, 2, 'country'],
      [foreign, otherId, 3, 'event'],
    ] as const) {
      await state.db.query(
        'INSERT INTO entities(id,workspace_id,local_id,kind,title,content,version) ' +
        'VALUES($1,$2,$3,$4,$5,$6::jsonb,1)',
        [id, ws, localId, kind, kind, JSON.stringify({ name: kind, graphPosition: { x: 0, y: 0 } })],
      )
    }
  })
  afterAll(async () => { await state.db?.close() })

  it('rejects guest, viewer, cross-origin, and cross-world nodes before any write', async () => {
    state.user = null
    expect((await post([a])).status).toBe(401)
    state.user = { id: 'ci-editor' }
    state.role = 'viewer'
    expect((await post([a])).status).toBe(404)
    state.role = 'editor'
    expect((await post([a], 'https://evil.test')).status).toBe(403)
    expect((await post([a, { ...b, id: foreign, entityType: 'event', localId: 3 }])).status)
      .toBe(404)
    expect((await versions()).map(x => x.version)).toEqual([1, 1])
  })

  it('commits all positions with one revision per changed entity; rejects stale and duplicate writes', async () => {
    const response = await post([b, a])
    expect(response.status).toBe(200)
    const data = await response.json() as { positions: { id: string; version: number }[] }
    expect(data.positions.map(x => x.version)).toEqual([2, 2])
    expect((await versions()).map(x => x.version)).toEqual([2, 2])
    const rev = await state.db!.query<{ count: string }>('SELECT count(*)::text AS count FROM entity_revisions')
    expect(rev.rows[0].count).toBe('2')
    const before = await versions()
    const stale = await post([{ ...a, x: 30 }, { ...b, x: 30 }])
    expect(stale.status).toBe(409)
    expect(await versions()).toEqual(before)
    const repeat = await post([{ ...a, expectedVersion: 2 }, { ...b, expectedVersion: 2 }])
    expect(repeat.status).toBe(200)
    expect((await versions()).map(x => x.version)).toEqual([2, 2])
  })

  it('rolls back all earlier changes when a later SQL statement fails', async () => {
    await state.db!.exec(
      "ALTER TABLE entities ADD CONSTRAINT ci_second_fails CHECK (" +
      "id <> '550e8400-e29b-41d4-a716-446655440002'::uuid OR version <= 2)",
    )
    const saved = await versions()
    await expect(post([
      { ...a, expectedVersion: 2, x: 123 },
      { ...b, expectedVersion: 2, x: 456 },
    ])).rejects.toThrow()
    expect(await versions()).toEqual(saved)
    const rev = await state.db!.query<{ count: string }>('SELECT count(*)::text AS count FROM entity_revisions')
    expect(rev.rows[0].count).toBe('2')
    const audits = await state.db!.query<{ count: string }>('SELECT count(*)::text AS count FROM audit_logs')
    expect(audits.rows[0].count).toBe('2')
  })
})

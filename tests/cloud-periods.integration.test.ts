// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const state = vi.hoisted(() => ({
  db: null as PGlite | null,
  actor: { id: 'user-1' } as { id: string } | null,
  role: 'owner' as 'owner' | 'editor' | 'viewer' | null,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/cloud/server/db', () => {
  const query = (sql: string, params?: unknown[]) => state.db!.query(sql, params)
  return { pool: { query, connect: async () => ({ query, release: () => {} }) } }
})
vi.mock('@/lib/cloud/server/authorization', () => ({
  currentCloudUser: async () => state.actor,
  isUuid: (id: unknown) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id),
  authorizedWorkspace: async (_user: unknown, _id: string, action: string) =>
    action === 'entity:read' || state.role !== 'viewer' ? state.role : null,
}))
vi.mock('@/lib/cloud/server/origin', () => ({
  mutationOriginAllowed: (request: Request) => request.headers.get('origin') === 'http://localhost:3000',
}))

import * as api from '@/app/api/workspaces/[workspaceId]/periods/route'

const world = '660e8400-e29b-41d4-a716-446655440001'
const ctx = { params: Promise.resolve({ workspaceId: world }) }
const example = { name: '旧时代', startTime: '-200', endTime: '100', color: 'bg-warning' }
function post(body: Record<string, unknown>, origin = 'http://localhost:3000') {
  return api.POST(new Request('http://localhost:3000/api/workspaces/' + world + '/periods', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), ctx)
}
async function read() {
  const res = await api.GET(new Request('http://localhost:3000/api/workspaces/' + world + '/periods'), ctx)
  return { status: res.status, body: await res.json() as {
    periods?: { id: number; name: string; color: string }[]; version?: number; error?: string
  } }
}

describe('workspace period management through PostgreSQL', () => {
  beforeAll(async () => {
    state.db = new PGlite()
    await state.db.exec(
      'CREATE TABLE workspaces (id UUID PRIMARY KEY, deleted_at TIMESTAMPTZ);' +
      'CREATE TABLE workspace_settings (' +
      'workspace_id UUID NOT NULL REFERENCES workspaces(id),' +
      'setting_key TEXT NOT NULL,setting_value JSONB NOT NULL,' +
      'version INTEGER NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),' +
      'PRIMARY KEY(workspace_id,setting_key));' +
      'CREATE TABLE audit_logs (workspace_id UUID, actor_id TEXT, action TEXT,' +
      'target_id UUID, details JSONB);',
    )
    await state.db.query('INSERT INTO workspaces(id) VALUES($1)', [world])
  })
  afterAll(async () => { await state.db?.close() })

  it('requires login, allowed origin and editor permissions', async () => {
    state.actor = null
    expect((await read()).status).toBe(401)
    expect((await post({ operation: 'create', period: example, expectedVersion: 0 })).status).toBe(401)
    state.actor = { id: 'user-1' }
    state.role = 'viewer'
    expect((await read()).status).toBe(200)
    expect((await post({ operation: 'create', period: example, expectedVersion: 0 })).status).toBe(404)
    state.role = 'editor'
    expect((await post({ operation: 'create', period: example, expectedVersion: 0 },
      'https://untrusted.test')).status).toBe(403)
  })

  it('creates periods, preserves desktop extras and checks stale versions', async () => {
    state.role = 'owner'
    const initial = await post({ operation: 'create', period: example, expectedVersion: 0 })
    expect(initial.status).toBe(200)
    const first = await initial.json() as { periods: { id: number; name: string }[]; version: number }
    expect(first.periods).toEqual([{ id: 1, ...example }])
    expect(first.version).toBe(1)
    const stale = await post({ operation: 'create', period: example, expectedVersion: 0 })
    expect(stale.status).toBe(409)
    const legacy = { periods: [{ ...example, id: 1 }], meta: [{ id: 1, worldName: '已导入' }],
      journal: ['创作日志保留'] }
    await state.db!.query(
      "UPDATE workspace_settings SET setting_value=$1::jsonb WHERE workspace_id=$2 AND setting_key='desktop-extras'",
      [JSON.stringify(legacy), world],
    )
    const edit = await post({ operation: 'update', id: 1, period: { ...example, name: '新时代' },
      expectedVersion: 1 })
    expect(edit.status).toBe(200)
    const saved = await state.db!.query<{ setting_value: {
      meta: { worldName: string }[]; journal: string[]; periods: { name: string }[]
    } }>(
      "SELECT setting_value FROM workspace_settings WHERE workspace_id=$1 AND setting_key='desktop-extras'",
      [world],
    )
    expect(saved.rows[0].setting_value.meta[0].worldName).toBe('已导入')
    expect(saved.rows[0].setting_value.journal).toEqual(['创作日志保留'])
    expect(saved.rows[0].setting_value.periods[0].name).toBe('新时代')
  })

  it('soft-deletes periods and writes audit logs', async () => {
    const removed = await post({ operation: 'delete', id: 1, expectedVersion: 2 })
    expect(removed.status).toBe(200)
    const result = await read()
    expect(result.body.periods).toEqual([])
    expect(result.body.version).toBe(3)
    const data = await state.db!.query<{ setting_value: {
      periods: { id: number; deleted?: boolean }[]
    } }>(
      "SELECT setting_value FROM workspace_settings WHERE workspace_id=$1 AND setting_key='desktop-extras'",
      [world],
    )
    expect(data.rows[0].setting_value.periods[0].deleted).toBe(true)
    const audit = await state.db!.query<{ action: string }>(
      'SELECT action FROM audit_logs WHERE workspace_id=$1 ORDER BY action', [world],
    )
    expect(audit.rows.map(row => row.action)).toEqual([
      'workspace:period:create', 'workspace:period:delete', 'workspace:period:update',
    ])
  })
})

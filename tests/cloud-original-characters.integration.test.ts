// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { OriginalCharactersCloudAdapter, CloudCharacterError } from '@/lib/cloud/adapters/original-characters'
import { buildDefaultCharacter } from '@/features/characters/services'
import { newCharacterData } from '@/lib/entity-defaults'

const state = vi.hoisted(() => ({ db: null as PGlite | null, userId: 'owner' as string | null }))
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/cloud/server/auth', () => ({
  auth: { api: { getSession: async () => state.userId ? { user: { id: state.userId, banned: false } } : null } },
}))
vi.mock('@/lib/cloud/server/db', () => {
  const query = (sql: string, params?: unknown[]) => state.db!.query(sql, params)
  return { pool: { query, connect: async () => ({ query, release: () => {} }) } }
})

import * as workspaceEntities from '@/app/api/workspaces/[workspaceId]/entities/route'
import * as legacyEntities from '@/app/api/workspaces/[workspaceId]/legacy-entities/route'
import * as entityRoute from '@/app/api/entities/[entityId]/route'
import * as revisionRoute from '@/app/api/entities/[entityId]/revisions/route'
import * as restoreRoute from '@/app/api/entities/[entityId]/restore/route'
import * as uploadRoute from '@/app/api/workspaces/[workspaceId]/media/route'
import * as mediaRoute from '@/app/api/media/[assetId]/route'

const workspaceA = '11111111-1111-4111-8111-111111111111'
const workspaceB = '22222222-2222-4222-8222-222222222222'
const ctxWorkspace = (workspaceId: string) => ({ params: Promise.resolve({ workspaceId }) })
const ctxEntity = (entityId: string) => ({ params: Promise.resolve({ entityId }) })

async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input, 'http://localhost:3000')
  const headers = new Headers(init.headers)
  if (init.method && init.method !== 'GET') headers.set('Origin', 'http://localhost:3000')
  const request = new Request(url, { ...init, headers })
  const path = url.pathname.split('/').filter(Boolean)
  if (path[1] === 'workspaces' && path[3] === 'legacy-entities') return legacyEntities.GET(request, ctxWorkspace(path[2]))
  if (path[1] === 'workspaces' && path[3] === 'entities') return workspaceEntities.POST(request, ctxWorkspace(path[2]))
  if (path[1] === 'entities' && path.length === 3) {
    return init.method === 'PATCH' ? entityRoute.PATCH(request, ctxEntity(path[2])) : entityRoute.DELETE(request, ctxEntity(path[2]))
  }
  throw new Error(`Unexpected request: ${input}`)
}

describe('original character adapter against PostgreSQL', () => {
  let mediaRoot: string
  beforeAll(async () => {
    process.env.BETTER_AUTH_URL = 'http://localhost:3000'
    mediaRoot = mkdtempSync(join(tmpdir(), 'ocstudio-cloud-test-'))
    process.env.MEDIA_ROOT = mediaRoot
    state.db = new PGlite()
    await state.db.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, banned BOOLEAN NOT NULL DEFAULT false)')
    for (const file of readdirSync('cloud/migrations').filter(name => name.endsWith('.sql')).sort()) {
      await state.db.exec(readFileSync(`cloud/migrations/${file}`, 'utf8'))
    }
    await state.db.query('INSERT INTO "user"(id,name,email) VALUES ($1,$1,$2),($3,$3,$4),($5,$5,$6)',
      ['owner', 'owner@example.test', 'editor', 'editor@example.test', 'outsider', 'outsider@example.test'])
    await state.db.query('INSERT INTO "user"(id,name,email) VALUES ($1,$1,$2)', ['viewer', 'viewer@example.test'])
    await state.db.query('INSERT INTO workspaces(id,owner_id,name) VALUES ($1,$3,$5),($2,$4,$6)',
      [workspaceA, workspaceB, 'owner', 'outsider', 'A', 'B'])
    await state.db.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$3,$5),($1,$4,$6),($2,$7,$5)',
      [workspaceA, workspaceB, 'owner', 'editor', 'owner', 'editor', 'outsider'])
    await state.db.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)',
      [workspaceA, 'viewer', 'viewer'])
  }, 30000)
  afterAll(async () => { await state.db?.close(); rmSync(mediaRoot, { recursive: true, force: true }) })

  it('saves original character fields, rejects stale edits, and restores history', async () => {
    const adapter = new OriginalCharactersCloudAdapter(workspaceA, apiFetch)
    const original = buildDefaultCharacter({ ...newCharacterData(), name: '角色 A' })
    const created = await adapter.create({ ...original, custom: { origin: '原版自定义字段' }, folder: '设定集' })
    expect(created.character.id).toBeGreaterThan(0)
    expect(created.version).toBe(1)
    expect((await adapter.list())[0].character.folder).toBe('设定集')

    state.userId = 'editor'
    const saved = await adapter.save(created, { name: '角色 B', bio: '新简介' })
    expect(saved.version).toBe(2)
    expect(saved.character.custom).toEqual({ origin: '原版自定义字段' })
    await expect(adapter.save(created, { name: '过期修改' })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT', status: 409, actualVersion: 2,
    })
    expect(created.character.name).toBe('角色 A')
    await state.db!.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)',
      [workspaceB, 'editor', 'editor'])
    const adapterB = new OriginalCharactersCloudAdapter(workspaceB, apiFetch)
    await expect(adapterB.save({ ...saved, workspaceId: workspaceB }, { name: '跨库错误写入' }))
      .rejects.toMatchObject({ status: 404 })

    state.userId = 'viewer'
    expect((await adapter.list())[0].character.name).toBe('角色 B')
    await expect(adapter.save(saved, { name: '访客修改' })).rejects.toMatchObject({ status: 404 })
    await expect(adapter.remove(saved)).rejects.toMatchObject({ status: 404 })

    state.userId = 'outsider'
    await expect(adapter.list()).rejects.toMatchObject({ status: 404 })
    await expect(adapter.save(saved, { name: '跨库写入' })).rejects.toMatchObject({ status: 404 })
    const other = new OriginalCharactersCloudAdapter(workspaceB, apiFetch)
    await expect(other.save(saved, { name: '错误资料库' })).rejects.toMatchObject({ code: 'WORKSPACE_MISMATCH' })

    state.userId = 'owner'
    const history = await revisionRoute.GET(new Request('http://localhost:3000'), ctxEntity(created.entityId))
    expect((await history.json()).revisions.map((item: { version: number }) => item.version)).toEqual([2, 1])
    const request = new Request('http://localhost:3000', {
      method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 2, restoreVersion: 1 }),
    })
    const restored = await restoreRoute.POST(request, ctxEntity(created.entityId))
    expect(restored.status).toBe(200)
    expect((await restored.json()).version).toBe(3)
    const latest = (await adapter.list())[0]
    expect(latest.character.name).toBe('角色 A')
    expect(latest.character.id).toBe(created.character.id)
    await adapter.remove(latest)
    expect(await adapter.list()).toEqual([])
  })

  it('reads characters after other entities across pagination boundaries', async () => {
    state.userId = 'owner'
    await state.db!.query(
      `INSERT INTO entities(workspace_id,kind,title,content,created_by,updated_by)
       SELECT $1,'event','event','{}'::jsonb,'owner','owner' FROM generate_series(1,105)`, [workspaceA],
    )
    const adapter = new OriginalCharactersCloudAdapter(workspaceA, apiFetch)
    const created = await adapter.create(buildDefaultCharacter({ ...newCharacterData(), name: '跨页角色' }))
    const all = await adapter.list()
    expect(all.map(item => item.character.name)).toEqual(['跨页角色'])
    expect(all[0].character.id).toBe(created.character.id)
  })

  it('accepts body images only from the character workspace', async () => {
    state.userId = 'owner'
    const own = '33333333-3333-4333-8333-333333333333'
    const other = '44444444-4444-4444-8444-444444444444'
    await state.db!.query(`INSERT INTO media_assets(id,workspace_id,uploaded_by,storage_key,mime_type,byte_size,content_sha256)
      VALUES ($1,$3,'owner','own.png','image/png',1,'own'),($2,$4,'outsider','other.png','image/png',1,'other')`,
    [own, other, workspaceA, workspaceB])
    const adapter = new OriginalCharactersCloudAdapter(workspaceA, apiFetch)
    const initial = await adapter.create(buildDefaultCharacter({ ...newCharacterData(), name: '图片角色' }))
    const doc = (id: string) => ({ type: 'doc', content: [{ type: 'imageBlock', attrs: { src: `/api/media/${id}` } }] })
    const saved = await adapter.save(initial, { document: doc(own) })
    expect(saved.version).toBe(2)
    await expect(adapter.save(saved, { document: doc(other) })).rejects.toMatchObject({ status: 400, code: 'INVALID_CHARACTER_MEDIA' })
    await expect(adapter.save(saved, { avatarUrl: `/api/media/${other}` })).rejects.toMatchObject({ status: 400, code: 'INVALID_CHARACTER_MEDIA' })
    expect((await adapter.list()).find(row => row.entityId === saved.entityId)?.version).toBe(2)
    const withAvatar = await adapter.save(saved, { avatarUrl: `/api/media/${own}`, headerUrl: `/api/media/${own}` })
    expect(withAvatar.version).toBe(3)
    expect(withAvatar.character.avatarUrl).toBe(`/api/media/${own}`)
    const removedAvatar = await adapter.save(withAvatar, { avatarUrl: '' })
    const restore = await restoreRoute.POST(new Request('http://localhost:3000', {
      method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: removedAvatar.version, restoreVersion: 3 }),
    }), ctxEntity(initial.entityId))
    expect(restore.status).toBe(200)
    const restored = (await adapter.list()).find(row => row.entityId === initial.entityId)
    expect(restored?.character.avatarUrl).toBe(`/api/media/${own}`)
  })

  it('uploads and reads private image bytes with workspace authorization', async () => {
    state.userId = 'owner'
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
    const form = new FormData()
    form.append('file', new File([bytes], 'image.png', { type: 'image/png' }))
    const result = await uploadRoute.POST(new Request('http://localhost:3000', {
      method: 'POST', headers: { Origin: 'http://localhost:3000' }, body: form,
    }), ctxWorkspace(workspaceA))
    expect(result.status).toBe(201)
    const { asset } = await result.json()
    const get = () => mediaRoute.GET(new Request('http://localhost:3000'), { params: Promise.resolve({ assetId: asset.id }) })
    expect(new Uint8Array(await (await get()).arrayBuffer())).toEqual(bytes)
    state.userId = 'viewer'
    expect((await get()).status).toBe(200)
    state.userId = 'outsider'
    expect((await get()).status).toBe(404)
  })

  it('enforces login and same-origin protection', async () => {
    state.userId = null
    const response = await legacyEntities.GET(new Request('http://localhost:3000'), ctxWorkspace(workspaceA))
    expect(response.status).toBe(401)
    state.userId = 'owner'
    const badOrigin = await workspaceEntities.POST(new Request('http://localhost:3000', {
      method: 'POST', headers: { Origin: 'http://attacker.invalid' }, body: '{}',
    }), ctxWorkspace(workspaceA))
    expect(badOrigin.status).toBe(403)
    expect(new CloudCharacterError('VERSION_CONFLICT', 409).message).toContain('版本冲突')
  })
})

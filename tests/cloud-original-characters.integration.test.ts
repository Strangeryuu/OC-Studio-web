// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { OriginalCharactersCloudAdapter, CloudCharacterError } from '@/lib/cloud/adapters/original-characters'
import { buildDefaultCharacter } from '@/features/characters/services'
import { newCharacterData, newCountryData, newEventData, newWorldEntryData } from '@/lib/entity-defaults'

import { OriginalCountriesCloudAdapter } from '@/lib/cloud/adapters/original-countries'
import { OriginalEventsCloudAdapter } from '@/lib/cloud/adapters/original-events'
import { OriginalNotesCloudAdapter } from '@/lib/cloud/adapters/original-notes'
import { buildDefaultEntry } from '@/features/world/services'
import { buildDefaultEvent } from '@/features/events/services'
import { buildDefaultCountry } from '@/features/countries/services'

import { resolveGraphPositions } from '@/features/relations/layout'
import { projectGraphData } from '@/features/relations/services'

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

import StudioEntry from '@/app/(studio)/studio/page'
import StudioWorkspace from '@/app/(studio)/studio/[workspaceId]/page'
import WorkspaceRedirect from '@/app/(studio)/workspaces/[workspaceId]/page'

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

describe('original entity adapters against PostgreSQL', () => {
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

  it('opens the authenticated workbench and preserves its legacy route', async () => {
    const redirectsTo = (path: string) => ({ digest: expect.stringContaining(`NEXT_REDIRECT;replace;${path};307`) })
    state.userId = null
    await expect(StudioEntry()).rejects.toMatchObject(redirectsTo('/login'))
    await expect(StudioWorkspace(ctxWorkspace(workspaceA))).rejects.toMatchObject(redirectsTo('/login'))

    state.userId = 'outsider'
    await expect(StudioWorkspace(ctxWorkspace(workspaceA))).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
    state.userId = 'viewer'
    await expect(StudioEntry()).rejects.toMatchObject(redirectsTo(`/studio/${workspaceA}`))
    await expect(WorkspaceRedirect(ctxWorkspace(workspaceA))).rejects.toMatchObject(redirectsTo(`/studio/${workspaceA}`))
    const editor = await StudioWorkspace(ctxWorkspace(workspaceA))
    expect(editor.props).toMatchObject({ role: 'viewer', workspaceId: workspaceA, workspaceName: 'A' })
    state.userId = 'owner'
  })

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

  it('restricts original character relationships to their workspace and retains history', async () => {
    state.userId = 'owner'
    const adapter = new OriginalCharactersCloudAdapter(workspaceA, apiFetch)
    const first = await adapter.create(buildDefaultCharacter({ ...newCharacterData(), name: '关系甲' }))
    const second = await adapter.create(buildDefaultCharacter({ ...newCharacterData(), name: '关系乙' }))
    state.userId = 'outsider'
    const foreign = await new OriginalCharactersCloudAdapter(workspaceB, apiFetch)
      .create(buildDefaultCharacter({ ...newCharacterData(), name: '其他资料库' }))
    state.userId = 'owner'
    const relation = (characterId: number, name: string) => [{ characterId, name, relation: '朋友' }]
    await expect(adapter.save(first, { relatedCharacters: relation(foreign.character.id!, '其他资料库') }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_CHARACTER_LINKS' })
    await expect(adapter.save(first, { relatedCharacters: relation(first.character.id!, '关系甲') }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_CHARACTER_LINKS' })
    const linked = await adapter.save(first, { relatedCharacters: relation(second.character.id!, '关系乙') })
    expect(linked.character.relatedCharacters[0].characterId).toBe(second.character.id)
    await expect(adapter.save(first, { relatedCharacters: [] })).rejects.toMatchObject({ status: 409 })
    await adapter.remove(second)
    const edited = await adapter.save(linked, { bio: '保留已删除角色的关系' })
    expect(edited.character.relatedCharacters[0].name).toBe('关系乙')
    const revisions = await revisionRoute.GET(new Request('http://localhost:3000'), ctxEntity(first.entityId))
    expect((await revisions.json()).revisions.map((item: { version: number }) => item.version)).toEqual([3, 2, 1])
  })

  it('saves original countries and validates nationality changes within the workspace', async () => {
    state.userId = 'owner'
    const countries = new OriginalCountriesCloudAdapter(workspaceA, apiFetch)
    const homeland = await countries.create(buildDefaultCountry({ ...newCountryData(), name: '故乡' }))
    const updated = await countries.save(homeland, { name: '王国', custom: { 首都: '都城' } })
    expect((await countries.list()).find(row => row.entityId === homeland.entityId)?.entity.custom).toEqual({ 首都: '都城' })
    await expect(countries.save(homeland, { name: '过期编辑' })).rejects.toMatchObject({ status: 409 })
    const history = await revisionRoute.GET(new Request('http://localhost:3000'), ctxEntity(updated.entityId))
    expect((await history.json()).revisions.map((row: { version: number }) => row.version)).toEqual([2, 1])

    state.userId = 'outsider'
    const external = await new OriginalCountriesCloudAdapter(workspaceB, apiFetch)
      .create(buildDefaultCountry({ ...newCountryData(), name: '另一个资料库' }))
    state.userId = 'viewer'
    expect((await countries.list()).map(row => row.entityId)).toContain(homeland.entityId)
    expect((await countries.list()).map(row => row.entityId)).not.toContain(external.entityId)
    await expect(countries.save(updated, { name: '访客编辑' })).rejects.toMatchObject({ status: 404 })

    state.userId = 'owner'
    const characters = new OriginalCharactersCloudAdapter(workspaceA, apiFetch)
    const character = await characters.create(buildDefaultCharacter({ ...newCharacterData(), name: '居民', nationalityLegacy: '旧国籍' }))
    await expect(characters.save(character, { countryId: external.entity.id })).rejects.toMatchObject({
      status: 400, code: 'INVALID_CHARACTER_LINKS',
    })
    await expect(characters.save(character, { countryId: character.character.id })).rejects.toMatchObject({
      status: 400, code: 'INVALID_CHARACTER_LINKS',
    })
    const linked = await characters.save(character, { countryId: homeland.entity.id, nationalityLegacy: '' })
    expect(linked.character.countryId).toBe(homeland.entity.id)
    await characters.save(linked, { countryId: null, nationalityLegacy: '' })
    const cleared = (await characters.list()).find(row => row.entityId === character.entityId)!
    expect(cleared.character.countryId).toBeUndefined()
    expect(cleared.character.nationalityLegacy).toBe('')
  })

  it('stores original events with scoped participants and relation targets', async () => {
    state.userId = 'owner'
    const events = new OriginalEventsCloudAdapter(workspaceA, apiFetch)
    const event = await events.create(buildDefaultEvent({ ...newEventData(), title: '天文研究会' }))
    const related = await events.create(buildDefaultEvent({ ...newEventData(), title: '观测计划' }))
    const character = await new OriginalCharactersCloudAdapter(workspaceA, apiFetch)
      .create(buildDefaultCharacter(newCharacterData()))
    const country = await new OriginalCountriesCloudAdapter(workspaceA, apiFetch)
      .create(buildDefaultCountry(newCountryData()))
    state.userId = 'outsider'
    const foreignEvent = await new OriginalEventsCloudAdapter(workspaceB, apiFetch)
      .create(buildDefaultEvent(newEventData()))
    state.userId = 'owner'

    const denied = { status: 400, code: 'INVALID_EVENT_LINKS' }
    await expect(events.save(event, { characters: [country.entity.id] })).rejects.toMatchObject(denied)
    await expect(events.save(event, { relations: [{ targetId: foreignEvent.entity.id, relation: '起因' }] }))
      .rejects.toMatchObject(denied)
    await expect(events.save(event, { relations: [{ targetId: event.entity.id, relation: '起因' }] }))
      .rejects.toMatchObject(denied)
    await expect(events.create(buildDefaultEvent({ ...newEventData(), countries: [foreignEvent.entity.id] })))
      .rejects.toMatchObject(denied)

    state.userId = 'editor'
    const saved = await events.save(event, {
      title: '天文观测会议', time: '2026-03', endTime: '2026-04',
      characters: [character.character.id], countries: [country.entity.id],
      relations: [{ targetId: related.entity.id, relation: '起因', arrow: 'forward' }],
    })
    expect(saved.version).toBe(2)
    await expect(events.save(event, { title: '过期修改' })).rejects.toMatchObject({ status: 409 })
    state.userId = 'viewer'
    const reread = (await events.list()).find(row => row.entityId === event.entityId)!
    expect(reread.entity).toMatchObject(saved.entity)
    await expect(events.save(reread, { location: '访客编辑' })).rejects.toMatchObject({ status: 404 })
    const history = await revisionRoute.GET(new Request('http://localhost:3000'), ctxEntity(event.entityId))
    expect((await history.json()).revisions.map((row: { version: number }) => row.version)).toEqual([2, 1])
  })

  it('versions notes and scopes their hierarchy, named links and inline references', async () => {
    state.userId = 'owner'
    const notes = new OriginalNotesCloudAdapter(workspaceA, apiFetch)
    const parent = await notes.create(buildDefaultEntry({ ...newWorldEntryData(), title: '主题' }))
    const child = await notes.create(buildDefaultEntry({ ...newWorldEntryData(), title: '子词条', parentId: parent.entity.id }))
    const characters = new OriginalCharactersCloudAdapter(workspaceA, apiFetch)
    const character = await characters.create(buildDefaultCharacter(newCharacterData()))
    state.userId = 'outsider'
    const external = await new OriginalNotesCloudAdapter(workspaceB, apiFetch).create(buildDefaultEntry(newWorldEntryData()))
    state.userId = 'owner'
    const invalid = { status: 400, code: 'INVALID_NOTE_LINKS' }
    await expect(notes.save(parent, { parentId: child.entity.id })).rejects.toMatchObject(invalid)
    await expect(notes.save(child, { parentId: external.entity.id })).rejects.toMatchObject(invalid)
    await expect(notes.save(child, { relations: [{ targetId: external.entity.id, name: '其他资料库', relation: '参考' }] }))
      .rejects.toMatchObject(invalid)
    await expect(characters.save(character, { relatedNotes: [{ targetId: external.entity.id, name: '资料', relation: '' }] }))
      .rejects.toMatchObject(invalid)
    const reference = (id: number) => ({ type: 'doc', content: [{
      type: 'paragraph', content: [{ type: 'wikiLink', attrs: { id: String(id), label: '主题' } }],
    }] })
    await expect(notes.save(child, { document: reference(external.entity.id) })).rejects.toMatchObject(invalid)

    state.userId = 'editor'
    const linked = await characters.save(character, { relatedNotes: [{ targetId: child.entity.id, name: '子词条', relation: '来源' }] })
    expect(linked.character.relatedNotes?.[0].targetId).toBe(child.entity.id)
    const doc = reference(parent.entity.id)
    const saved = await notes.save(child, { document: doc, relations: [{ targetId: parent.entity.id, name: '主题', relation: '参考' }] })
    expect(saved.version).toBe(2)
    await expect(notes.save(child, { title: '过期编辑' })).rejects.toMatchObject({ status: 409 })

    state.userId = 'viewer'
    const visible = await notes.list()
    expect(visible.find(item => item.entityId === child.entityId)?.entity.document).toEqual(doc)
    expect(visible.some(item => item.entityId === external.entityId)).toBe(false)
    await expect(notes.save(saved, { title: '访客编辑' })).rejects.toMatchObject({ status: 404 })
    const history = await revisionRoute.GET(new Request('http://localhost:3000'), ctxEntity(child.entityId))
    expect((await history.json()).revisions.map((row: { version: number }) => row.version)).toEqual([2, 1])
  })

  it('projects cloud notes and relations and saves graph positions with version checks', async () => {
    state.userId = 'owner'
    const notes = new OriginalNotesCloudAdapter(workspaceA, apiFetch)
    const characters = new OriginalCharactersCloudAdapter(workspaceA, apiFetch)
    const country = await new OriginalCountriesCloudAdapter(workspaceA, apiFetch)
      .create(buildDefaultCountry(newCountryData()))
    const character = await characters.create(buildDefaultCharacter({
      ...newCharacterData(), name: '记录者', countryId: country.entity.id,
    }))
    const target = await notes.create(buildDefaultEntry({ ...newWorldEntryData(), title: '年鉴' }))
    const note = await notes.create({
      ...buildDefaultEntry({ ...newWorldEntryData(), title: '普通笔记' }),
      relations: [{ targetId: target.entity.id, name: '年鉴', relation: '沿袭', arrow: 'forward' }],
      document: {
        type: 'doc', content: [{ type: 'paragraph', content: [
          { type: 'wikiLink', attrs: { id: String(target.entity.id), label: '年鉴' } },
          { type: 'mention', attrs: { id: String(character.character.id), label: '记录者', entityType: 'character' } },
        ] }],
      },
    })
    state.userId = 'editor'
    const moved = await notes.save(note, { graphPosition: { x: 0, y: 0 } })
    expect(moved.version).toBe(2)
    await expect(notes.save(note, { graphPosition: { x: 80, y: 104 } })).rejects.toMatchObject({ status: 409 })
    const invalid = await apiFetch(`/api/entities/${note.entityId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: note.entity.title, expectedVersion: 2, data: { graphPosition: { x: '80', y: 104 } } }),
    })
    expect(invalid.status).toBe(400)

    state.userId = 'viewer'
    const reopened = (await notes.list()).find(row => row.entityId === note.entityId)!
    const graph = projectGraphData({
      characters: [character.character], notes: [reopened.entity, target.entity], countries: [country.entity], events: [],
    }, true)
    const positioned = resolveGraphPositions(graph.nodes, graph.edges)
    expect(positioned.find(node => node.id === `world-${note.entity.id}`)?.position).toEqual({ x: 0, y: 0 })
    expect(graph.edges.map(edge => [edge.data?.kind, edge.data?.relation])).toEqual([
      ['relation', '沿袭'], ['reference', '引用'], ['member', '属于'],
    ])
    await expect(notes.save(reopened, { graphPosition: { x: 120, y: 160 } })).rejects.toMatchObject({ status: 404 })
    state.userId = 'owner'
  })

  it('accepts body images only from the character workspace', async () => {
    state.userId = 'owner'
    const own = '33333333-3333-4333-8333-333333333333'
    const other = '44444444-4444-4444-8444-444444444444'
    await state.db!.query(`INSERT INTO media_assets(id,workspace_id,uploaded_by,storage_key,mime_type,byte_size,content_sha256)
      VALUES ($1,$3,'owner','own.png','image/png',1,'own'),($2,$4,'outsider','other.png','image/png',1,'other')`,
    [own, other, workspaceA, workspaceB])
    const countries = new OriginalCountriesCloudAdapter(workspaceA, apiFetch)
    const country = await countries.create(buildDefaultCountry(newCountryData()))
    await expect(countries.save(country, { flagUrl: `/api/media/${other}` }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_COUNTRY_MEDIA' })
    const withFlag = await countries.save(country, { flagUrl: `/api/media/${own}` })
    expect(withFlag.entity.flagUrl).toBe(`/api/media/${own}`)
    const events = new OriginalEventsCloudAdapter(workspaceA, apiFetch)
    const gathering = await events.create(buildDefaultEvent(newEventData()))
    await expect(events.save(gathering, { images: [{ url: `/api/media/${other}`, caption: '' }] }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_EVENT_MEDIA' })
    const withImage = await events.save(gathering, { images: [{ url: `/api/media/${own}`, caption: '会场' }] })
    expect(withImage.entity.images).toEqual([{ url: `/api/media/${own}`, caption: '会场' }])
    const notes = new OriginalNotesCloudAdapter(workspaceA, apiFetch)
    const entry = await notes.create(buildDefaultEntry(newWorldEntryData()))
    const noteBody = (id: string) => ({ type: 'doc', content: [
      { type: 'imageBlock', attrs: { src: `/api/media/${id}` } },
    ] })
    await expect(notes.save(entry, { document: noteBody(other) }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_NOTE_MEDIA' })
    const savedNote = await notes.save(entry, { document: noteBody(own) })
    expect(savedNote.entity.document).toEqual(noteBody(own))
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
    await expect(adapter.save(restored!, { gallery: [{ url: `/api/media/${other}`, caption: '' }] }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_CHARACTER_MEDIA' })
    await expect(adapter.save(restored!, { avatars: [{ url: `/api/media/${other}`, type: 'portrait' }] }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_CHARACTER_MEDIA' })
    const gallerySaved = await adapter.save(restored!, { gallery: [{ url: `/api/media/${own}`, caption: '保留文字' }], avatars: [{ url: `/api/media/${own}`, type: 'fullbody' }] })
    const reread = (await adapter.list()).find(row => row.entityId === initial.entityId)
    expect(reread?.version).toBe(gallerySaved.version)
    expect(reread?.character.gallery[0].caption).toBe('保留文字')
    expect(reread?.character.avatars[0].type).toBe('fullbody')
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

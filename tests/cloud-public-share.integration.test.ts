// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

const state = vi.hoisted(() => ({
  db: null as PGlite | null,
  actor: null as { id: string; role: string | null; email: string; name: string } | null,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/cloud/server/db', () => {
  const query = (sql: string, values?: unknown[]) => state.db!.query(sql, values)
  return { pool: { query, connect: async () => ({ query, release: () => {} }) } }
})
vi.mock('@/lib/cloud/server/authorization', () => ({
  currentCloudUser: async () => state.actor,
  isUuid: (value: unknown) => typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
}))
vi.mock('@/lib/cloud/server/media-store', () => ({
  readPrivateImage: async () => new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ]),
}))

import * as api from '@/app/api/workspaces/[workspaceId]/public-share/route'
import * as guestMedia from '@/app/api/public-shares/[token]/media/[assetId]/route'
import { decryptShareToken, encryptShareToken, newShareToken, sharedWorkspace, shareImageUrl,
  shareMediaUrl, validShareToken } from '@/lib/cloud/server/public-share'
import { PublicWorkspaceViewer } from '@/components/cloud/PublicWorkspaceViewer'

const owner = '550e8400-e29b-41d4-a716-446655440001'
const collaborator = '550e8400-e29b-41d4-a716-446655440002'
const administrator = '550e8400-e29b-41d4-a716-446655440003'
const world = '660e8400-e29b-41d4-a716-446655440001'
const otherWorld = '660e8400-e29b-41d4-a716-446655440002'
const photo = '770e8400-e29b-41d4-a716-446655440001'
const otherPhoto = '770e8400-e29b-41d4-a716-446655440002'
const ctx = (workspaceId = world) => ({ params: Promise.resolve({ workspaceId }) })
function req(method: string, workspaceId = world, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/workspaces/' + workspaceId + '/public-share',
    { method, headers: { Origin: origin } })
}
async function issue(workspaceId = world) {
  const response = await api.POST(req('POST', workspaceId), ctx(workspaceId))
  const data = await response.json() as { path?: string; error?: string }
  return { response, data, token: data.path?.split('/').at(-1) ?? '' }
}
async function image(token: string, assetId = photo) {
  return guestMedia.GET(new Request('http://localhost:3000/api/public-shares/' + token + '/media/' + assetId),
    { params: Promise.resolve({ token, assetId }) })
}
function actor(id: string, role = 'user') {
  state.actor = { id, role, email: id + '@example.test', name: id }
}

describe('revocable public workspace sharing', () => {
  beforeAll(async () => {
    process.env.BETTER_AUTH_URL = 'http://localhost:3000'
    process.env.BETTER_AUTH_SECRET = 'test_share_secret_secure_long_enough_for_ci_2026'
    state.db = new PGlite()
    await state.db.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY)')
    await state.db.exec('CREATE TABLE workspaces (id UUID PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES "user"(id), name TEXT NOT NULL, description TEXT, deleted_at TIMESTAMPTZ)')
    await state.db.exec('CREATE TABLE audit_logs (workspace_id UUID, actor_id TEXT, action TEXT, target_id TEXT)')
    await state.db.exec('CREATE TABLE media_assets (id UUID PRIMARY KEY,workspace_id UUID NOT NULL,storage_key TEXT NOT NULL,mime_type TEXT NOT NULL,deleted_at TIMESTAMPTZ)')
    await state.db.exec(readFileSync('cloud/migrations/0008_workspace_public_shares.sql','utf8'))
    for (const id of [owner,collaborator,administrator])
      await state.db!.query('INSERT INTO "user"(id) VALUES($1)', [id])
    await state.db!.query('INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)', [world,owner,'我的世界观'])
    await state.db!.query('INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)', [otherWorld,collaborator,'其他世界观'])
    await state.db!.query('INSERT INTO media_assets(id,workspace_id,storage_key,mime_type) VALUES($1,$2,$3,$4)',
      [photo,world,world+'/a.png','image/png'])
    await state.db!.query('INSERT INTO media_assets(id,workspace_id,storage_key,mime_type) VALUES($1,$2,$3,$4)',
      [otherPhoto,otherWorld,otherWorld+'/b.png','image/png'])
  })
  afterAll(async () => { await state.db?.close() })

  it('generates secure encrypted links and rewrites scoped image URLs', () => {
    const token = newShareToken()
    expect(validShareToken(token)).toBe(true)
    expect(token).toHaveLength(64)
    expect(decryptShareToken(encryptShareToken(token))).toBe(token)
    expect(shareImageUrl(token,'/api/media/'+photo))
      .toBe('/api/public-shares/'+token+'/media/'+photo)
    expect(shareImageUrl(token,'javascript:alert(1)')).toBeNull()
    expect(shareMediaUrl(token,'![图片](/api/media/'+photo+')'))
      .toContain('/api/public-shares/'+token+'/media/'+photo)
  })

  it('allows only actual owners or global site administrators to manage links', async () => {
    state.actor = null
    expect((await api.GET(req('GET'),ctx())).status).toBe(401)
    expect((await api.POST(req('POST'),ctx())).status).toBe(401)
    actor(collaborator)
    expect((await api.GET(req('GET'),ctx())).status).toBe(404)
    expect((await api.POST(req('POST'),ctx())).status).toBe(404)
    expect((await api.DELETE(req('DELETE'),ctx())).status).toBe(404)
    actor(owner)
    expect((await api.POST(req('POST',world,'https://attacker.test'),ctx())).status).toBe(403)
    expect((await api.POST(req('POST',otherWorld),ctx(otherWorld))).status).toBe(404)
    actor(administrator,'admin')
    const elevated = await issue(otherWorld)
    expect(elevated.response.status).toBe(201)
    expect((await sharedWorkspace(elevated.token))?.id).toBe(otherWorld)
    expect((await api.DELETE(req('DELETE',otherWorld),ctx(otherWorld))).status).toBe(200)
    expect(await sharedWorkspace(elevated.token)).toBeNull()
  })

  it('revokes and rotates tokens for anonymous page and private media access', async () => {
    actor(owner)
    const first = await issue()
    expect(first.response.status).toBe(201)
    expect((await sharedWorkspace(first.token))?.name).toBe('我的世界观')
    expect((await (await api.GET(req('GET'),ctx())).json()).path).toBe('/share/'+first.token)
    expect((await image(first.token)).status).toBe(200)
    expect((await image(first.token,otherPhoto)).status).toBe(404)
    expect((await image('wrong-token')).status).toBe(404)
    const next = await issue()
    expect(next.token).not.toBe(first.token)
    expect(await sharedWorkspace(first.token)).toBeNull()
    expect((await image(first.token)).status).toBe(404)
    expect((await image(next.token)).status).toBe(200)
    expect((await api.DELETE(req('DELETE'),ctx())).status).toBe(200)
    expect((await (await api.GET(req('GET'),ctx())).json()).active).toBe(false)
    expect(await sharedWorkspace(next.token)).toBeNull()
    expect((await image(next.token)).status).toBe(404)
    expect((await state.db!.query('SELECT id FROM workspaces WHERE id=$1',[world])).rowCount).toBe(1)
    const fresh = await issue()
    expect((await sharedWorkspace(fresh.token))?.id).toBe(world)
    await state.db!.query('UPDATE workspaces SET deleted_at=now() WHERE id=$1',[world])
    expect(await sharedWorkspace(fresh.token)).toBeNull()
    expect((await image(fresh.token)).status).toBe(404)
  })

  it('renders content as a read-only guest page with proxied images', () => {
    const token = newShareToken(), media = '/api/media/'+photo
    const html = renderToStaticMarkup(createElement(PublicWorkspaceViewer, {
      token,workspace:{id:world,name:'展示世界观',description:null},cover:media,categories:['武器'],
      entries:[{id:'880e8400-e29b-41d4-a716-446655440001',local_id:'1',kind:'worldEntry',
        title:'测试词条',updated_at:'2026-11-19',content:{category:'武器',summary:'一段可阅读的介绍',
          document:{type:'doc',content:[{type:'paragraph',content:[
            {type:'text',text:'安全只读正文'},{type:'image',attrs:{src:media,alt:'示意图'}},
          ]}]}}}],
      selection:{section:'world',entry:'880e8400-e29b-41d4-a716-446655440001'},
    }))
    expect(html).toContain('安全只读正文')
    expect(html).toContain('一段可阅读的介绍')
    expect(html).toContain('/api/public-shares/'+token+'/media/'+photo)
    expect(html).not.toContain('contenteditable=')
    expect(html).not.toContain('/api/workspaces/')
    expect(html).not.toContain('method="post"')
  })
})

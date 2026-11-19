'use strict'

// Runs against the isolated PostgreSQL/Next.js CI server. Chromium touch
// emulation validates real browser events; iOS Safari/Android hardware remain
// separate manual device acceptance checks.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const BASE = 'http://localhost:3000'
const PASSWORD = 'CI_only_SecurePass_456789'
let browser
let desktopPage
let mobilePage

async function login(context) {
  // Use the same Better Auth credential endpoint already validated by the
  // PostgreSQL HTTP smoke, but retain each browser context's separate cookie jar.
  // Browser acceptance here tests graph/timeline behavior, not login animations.
  const loginResponse = await context.request.post(BASE + '/api/auth/sign-in/email', {
    headers: { Origin: BASE },
    data: { email: 'ci-admin@example.test', password: PASSWORD },
  })
  assert.equal(loginResponse.status(), 200,
    'Better Auth browser context login returned HTTP ' + loginResponse.status())
  const page = await context.newPage()
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  return page
}
async function requestOk(res, label, expected = 201) {
  const body = await res.json().catch(() => ({}))
  assert.equal(res.status(), expected, label + ': HTTP ' + res.status() + ' ' + JSON.stringify(body))
  return body
}
function characterData(name, x) {
  const now = Date.now()
  return {
    name, aliases: [], race: '', element: '', occupation: '', faction: '',
    height: '', birthday: '', avatarUrl: '', bio: '', lifeStory: '',
    relatedCharacters: [], gallery: [], avatars: [], tags: [],
    createdAt: now, updatedAt: now, deleted: false,
    _syncStatus: 'synced', _lastModified: now,
    graphPosition: { x, y: 120 },
  }
}
async function openSection(page, worldId, label) {
  await page.goto(BASE + '/studio/' + worldId, { waitUntil: 'domcontentloaded' })
  const button = page.getByRole('navigation', { name: '工作台板块' })
    .getByRole('button', { name: label, exact: true })
  await button.click()
}

async function run() {
  browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox'] })
  const desktop = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true,
    hasTouch: true, deviceScaleFactor: 3,
  })
  desktopPage = await login(desktop)
  mobilePage = await login(mobile)

  const world = await requestOk(await desktop.request.post(BASE + '/api/workspaces', {
    headers: { Origin: BASE },
    data: { name: 'CI Browser Graph / Timeline World' },
  }), 'create workspace')
  const worldId = world.workspace.id
  for (const [title, x] of [['CI Touch Alpha', 90], ['CI Touch Beta', 210]]) {
    await requestOk(await desktop.request.post(BASE + '/api/workspaces/' + worldId + '/entities', {
      headers: { Origin: BASE },
      data: { kind: 'character', title, data: characterData(title, x) },
    }), 'create graph node')
  }
  await requestOk(await desktop.request.post(BASE + '/api/workspaces/' + worldId + '/entities', {
    headers: { Origin: BASE },
    data: { kind: 'event', title: 'CI Time Milestone',
      data: { title: 'CI Time Milestone', time: '1024', endTime: '1030', isMajor: true } },
  }), 'create timeline event')

  await openSection(desktopPage, worldId, '关系图')
  await desktopPage.locator('.react-flow__node').first().waitFor({ timeout: 15000 })
  assert((await desktopPage.locator('.react-flow__node').count()) >= 2,
    'Desktop graph did not render two nodes')

  await openSection(mobilePage, worldId, '关系图')
  await mobilePage.locator('[data-touch-connect="on"]').waitFor({ timeout: 15000 })
  assert((await mobilePage.locator('.react-flow__handle').count()) >= 8,
    'Mobile graph must show touch connection handles')
  await mobilePage.screenshot({ path: '/tmp/ocstudio-browser-mobile-graph.png' })

  // Chromium DevTools touch sequences emulate a finger dragging from one
  // visible character handle to another; mouse drag is not a substitute.
  const alpha = mobilePage.locator('.react-flow__node').filter({ hasText: 'CI Touch Alpha' })
  const beta = mobilePage.locator('.react-flow__node').filter({ hasText: 'CI Touch Beta' })
  const start = await alpha.locator('.react-flow__handle-right').boundingBox()
  const end = await beta.locator('.react-flow__handle-left').boundingBox()
  assert(start && end, 'Character connection handles are not visible')
  const center = rect => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
  const s = center(start), e = center(end)
  const cdp = await mobile.newCDPSession(mobilePage)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: s.x, y: s.y }],
  })
  for (let n = 1; n <= 12; n += 1) {
    const x = s.x + (e.x - s.x) * n / 12
    const y = s.y + (e.y - s.y) * n / 12
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x, y }],
    })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const relationDialog = mobilePage.getByRole('dialog')
  await relationDialog.getByText('添加关系', { exact: true }).waitFor({ timeout: 8000 })
  await relationDialog.getByRole('textbox', { name: '关系名' }).fill('CI Touch Friend')
  await relationDialog.getByRole('button', { name: '添加', exact: true }).click()
  await relationDialog.waitFor({ state: 'hidden', timeout: 15000 })

  // Real independent cookie jars emulate two logged-in devices. Layout
  // writes are atomic and a stale second-device snapshot receives HTTP 409.
  const url = BASE + '/api/workspaces/' + worldId + '/legacy-entities?kind=character'
  const list = await (await desktop.request.get(url)).json()
  const rows = list.entities
  assert.equal(rows.length, 2, 'Expected two graph characters')
  const batch = rows.map((row, i) => ({
    id: row.id, entityType: 'character', localId: Number(row.local_id),
    expectedVersion: row.version, x: 400 + i * 200, y: 120 + i * 130,
  }))
  const first = await desktop.request.post(BASE + '/api/workspaces/' + worldId + '/graph-layout', {
    headers: { Origin: BASE }, data: { positions: batch },
  })
  await requestOk(first, 'multi-node layout', 200)
  const stale = await mobile.request.post(BASE + '/api/workspaces/' + worldId + '/graph-layout', {
    headers: { Origin: BASE },
    data: { positions: batch.map(row => ({ ...row, x: row.x + 20 })) },
  })
  assert.equal(stale.status(), 409, 'Stale second device must receive VERSION_CONFLICT')
  const authoritative = await (await mobile.request.get(url)).json()
  for (const row of authoritative.entities) {
    const expected = batch.find(item => item.id === row.id)
    assert.equal(row.version, expected.expectedVersion + 1, 'Version should increment once per node')
    assert.equal(row.content.graphPosition.x, expected.x, 'Conflict must leave all positions untouched')
  }
  await openSection(mobilePage, worldId, '关系图')
  assert((await mobilePage.locator('.react-flow__node').count()) >= 2,
    'Second device did not reload graph after layout')

  await openSection(desktopPage, worldId, '时间线')
  await desktopPage.getByRole('button', { name: '导出图片' }).click()
  const panel = desktopPage.getByRole('dialog', { name: '导出中心 · 时间线' })
  await panel.waitFor({ timeout: 15000 })
  await panel.getByRole('img', { name: '时间线预览' }).waitFor({ timeout: 20000 })
  await panel.getByPlaceholder('时间线').fill('CI Export Milestones')
  await panel.getByRole('button', { name: '紧凑' }).click()
  await panel.getByRole('img', { name: '时间线预览' }).waitFor({ timeout: 20000 })
  assert(await panel.getByRole('button', { name: '导出 PNG' }).isEnabled(),
    'Advanced export should allow downloading a rendered timeline')
  await desktopPage.screenshot({ path: '/tmp/ocstudio-browser-timeline-export.png' })
  await panel.getByRole('button', { name: '返回时间线' }).click()
  await panel.waitFor({ state: 'hidden' })
  process.stdout.write('Chromium browser acceptance passed: desktop timeline export; mobile touch drag; two-device layout version conflict.\n')
}
run().catch(async error => {
  process.stderr.write('Browser acceptance failed: ' + (error.stack || error) + '\n')
  for (const [page, name] of [[desktopPage, 'desktop-failure'], [mobilePage, 'mobile-failure']]) {
    if (page) await page.screenshot({ path: '/tmp/ocstudio-browser-' + name + '.png' }).catch(() => undefined)
  }
  process.exitCode = 1
}).finally(async () => { if (browser) await browser.close() })

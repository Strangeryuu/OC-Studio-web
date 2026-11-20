'use strict'

// Runs against the isolated PostgreSQL/Next.js CI server. Chromium touch
// emulation validates real browser events; iOS Safari/Android hardware remain
// separate manual device acceptance checks.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const BASE = 'http://localhost:3000'
const PASSWORD = 'CI_only_SecurePass_456789'
let browser
let desktopPage
let mobilePage

async function login(context) {
  // Use the same Better Auth credential endpoint already validated by the
  // PostgreSQL HTTP smoke, but retain each browser context's separate cookie jar.
  // Browser acceptance here tests graph/timeline behavior, not login animations.
  let loginResponse
  for (let attempt = 0; attempt < 4; attempt += 1) {
    loginResponse = await context.request.post(BASE + '/api/auth/sign-in/email', {
      headers: { Origin: BASE },
      data: { email: 'ci-admin@example.test', password: PASSWORD },
    })
    if (loginResponse.status() !== 429) break
    // The existing HTTP smoke also signs in. Honor Better Auth's rate limit
    // window instead of sharing tokens or disabling production protections.
    if (attempt < 3) {
      const retryAfter = Number(loginResponse.headers()['retry-after'])
      const pause = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(120, Math.max(1, retryAfter)) * 1000 : 65_000
      await new Promise(resolve => setTimeout(resolve, pause))
    }
  }
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
  // Entity list rows appear only after the client has hydrated and fetched
  // cloud data. Clicking nav during the pre-hydration HTML phase is a no-op.
  await page.getByRole('button', { name: 'CI Touch Alpha', exact: true })
    .waitFor({ timeout: 20000 })
  const button = page.getByRole('navigation', { name: '工作台板块' })
    .getByRole('button', { name: label, exact: true })
  await button.click()
  await page.locator('nav[aria-label="工作台板块"] button[aria-current="page"]')
    .filter({ hasText: label }).waitFor({ timeout: 15000 })
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
  await mobilePage.locator('.react-flow__node').first().waitFor({ timeout: 15000 })
  assert((await mobilePage.locator('.react-flow__node').count()) >= 2,
    'Second device did not reload graph after layout')

  // Real pointer travel from the integrated avatar action menu into a portaled
  // submenu must not dismiss either menu. This exercises the common PointMenu
  // used by media controls and editor context menus in an actual browser.
  await openSection(desktopPage, worldId, '角色')
  await desktopPage.getByRole('button', { name: 'CI Touch Alpha', exact: true }).click()
  await desktopPage.getByRole('button', { name: '头像操作' }).waitFor({ timeout: 15000 })
  await desktopPage.getByRole('button', { name: '头像操作' }).click()
  const avatarCategory = desktopPage.getByRole('menuitem', { name: '头像', exact: true })
  await avatarCategory.hover()
  const avatarUpload = desktopPage.getByRole('menuitem', { name: '上传头像', exact: true })
  await avatarUpload.waitFor({ timeout: 5000 })
  await avatarUpload.hover()
  await desktopPage.waitForTimeout(650)
  assert(await avatarUpload.isVisible(), 'Avatar submenu disappeared while choosing an action')
  assert(await avatarCategory.isVisible(), 'Avatar parent menu disappeared during submenu hover')
  const avatarFileChooser = desktopPage.waitForEvent('filechooser', { timeout: 5000 })
  await avatarUpload.click()
  const chooser = await avatarFileChooser
  await chooser.setFiles([])

  // Right-click insertion submenu must also stay open after the selection
  // changes as focus moves from the editor to its nested menu.
  const editorBody = desktopPage.locator('.ProseMirror[contenteditable="true"]').first()
  await editorBody.waitFor({ timeout: 15000 })
  await editorBody.click({ button: 'right', position: { x: 25, y: 25 } })
  const insertMenu = desktopPage.getByRole('menuitem', { name: '插入', exact: true })
  await insertMenu.hover()
  const separator = desktopPage.getByRole('menuitem', { name: '分割线', exact: true })
  await separator.waitFor({ timeout: 5000 })
  await separator.hover()
  await desktopPage.waitForTimeout(650)
  assert(await separator.isVisible(), 'Editor insertion submenu disappeared before selection')
  await separator.click()
  await editorBody.locator('hr').first().waitFor({ timeout: 5000 })
  await desktopPage.screenshot({ path: '/tmp/ocstudio-browser-context-submenu.png' })

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

  // The original poster/site/document panels are now reused with authorized
  // cloud snapshots. Check the actual workspace button, tab scope and data.
  await openSection(desktopPage, worldId, '角色')
  await desktopPage.getByRole('button', { name: '导出中心', exact: true }).click()
  const cloudExport = desktopPage.getByRole('dialog', { name: '导出中心' })
  await cloudExport.waitFor({ timeout: 20000 })
  for (const tab of ['海报', '网站', '文档']) {
    assert.equal(await cloudExport.getByRole('tab', { name: tab, exact: true }).count(), 1,
      'Cloud export should include original ' + tab + ' tab')
  }
  assert.equal(await cloudExport.getByRole('tab', { name: '备份' }).count(), 0,
    'Cloud export must exclude the local Dexie-only backup panel')
  await cloudExport.getByRole('tab', { name: '文档' }).click()
  const documentPanel = cloudExport.getByRole('tabpanel', { name: '文档' })
  await documentPanel.getByText('CI Touch Alpha').first().waitFor({ timeout: 15000 })
  await cloudExport.getByRole('tab', { name: '网站' }).click()
  const websitePanel = cloudExport.getByRole('tabpanel', { name: '网站' })
  const iframe = websitePanel.getByTitle('静态站预览')
  try {
    await iframe.waitFor({ state: 'attached', timeout: 15000 })
  } catch (cause) {
    const snapshot = (await websitePanel.innerText().catch(() => '')).slice(0, 1800)
    throw new Error('Cloud site iframe missing; panel text: ' + snapshot, { cause })
  }
  await desktopPage.waitForFunction(() => {
    const frame = document.querySelector('iframe[title="静态站预览"]')
    return frame && (frame.getAttribute('srcdoc') || '').includes('CI Touch Alpha')
  }, null, { timeout: 15000 })
  const html = await iframe.getAttribute('srcdoc')
  assert(html && html.includes('CI Touch Alpha'), 'Static site export omitted the cloud workspace character')
  await cloudExport.getByRole('button', { name: '返回' }).click()
  await cloudExport.waitFor({ state: 'hidden' })
  // Category archive uses a separate incremental protocol. A real browser
  // verifies file contents and duplicate-preview UX without mutating live data.
  await openSection(desktopPage, worldId, '备份与迁移')
  await desktopPage.getByText('分类归档 · 跨世界观迁移').waitFor({ timeout: 15000 })
  const categoryDownloadReady = desktopPage.waitForEvent('download', { timeout: 30000 })
  await desktopPage.getByRole('button', { name: '下载分类 .ocbak' }).click()
  const categoryDownload = await categoryDownloadReady
  const archivePath = await categoryDownload.path()
  assert(archivePath, 'Category archive download path is missing')
  const archive = JSON.parse(readFileSync(archivePath, 'utf8'))
  assert.equal(archive.format, 'oc-studio-web-category-v1')
  assert(archive.records.some(row => row.kind === 'character' && row.title === 'CI Touch Alpha'))
  assert(!archive.records.some(row => row.kind === 'event' && row.title === 'CI Time Milestone'),
    'Category export included an unrelated event')
  await desktopPage.getByLabel('选择分类归档').setInputFiles(archivePath)
  await desktopPage.getByText('确认导入内容').waitFor({ timeout: 20000 })
  assert(await desktopPage.getByText(/目标同名条目/).count(),
    'Category preview did not show duplicate detection')
  // Overwrite is opt-in and gated by the signed, version-bound preview.
  const overwriteChoice = desktopPage.getByRole('radio', { name: /覆盖同名条目/ })
  await overwriteChoice.waitFor({ timeout: 12000 })
  await overwriteChoice.click()
  assert.equal(await overwriteChoice.isChecked(), true, 'Overwrite strategy could not be selected')
  assert.equal(await desktopPage.getByRole('button', { name: '确认导入' }).isDisabled(), true,
    'Overwrite must require explicit user acknowledgement')
  await desktopPage.getByRole('button', { name: '取消' }).click()
  // OC-editor's OCAV payload is recognized without touching its original
  // source file or performing an import during browser acceptance.
  const nativeOcav = {
    format: 'oc-editor-ocav', version: 1, kind: 'character',
    exportedAt: '2026-11-20T00:00:00Z', world: { name: 'OC editor browser' },
    payload: {
      table: 'characters', contextMode: 'create',
      items: [{ id: 1, name: 'CI Touch Alpha', avatarUrl: '', bio: 'CI fixture',
        relatedCharacters: [], tags: [] }],
      context: { characters: [], events: [], countries: [], worldEntries: [], tags: [] },
      folders: [], refs: [],
    },
    relations: [],
  }
  await desktopPage.getByLabel('选择分类归档').setInputFiles({
    name: 'oc-editor-native.ocbak', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(nativeOcav)),
  })
  await desktopPage.getByText('确认导入内容').waitFor({ timeout: 20000 })
  assert(await desktopPage.getByText(/OC editor browser/).count(),
    'Native OC-editor file did not reach the incremental preview')
  await desktopPage.getByRole('button', { name: '取消' }).click()
  // Map advanced-mode acceptance: private 2:1 world image, WebGL canvas,
  // non-destructive 2D fallback and original worker-backed profile sampling.
  const mapImageUrl=await desktopPage.evaluate(async(worldId)=>{
    const canvas=document.createElement('canvas')
    canvas.width=512;canvas.height=256
    const ctx=canvas.getContext('2d')
    if(!ctx)throw new Error('Chrome 2D canvas unavailable')
    for(let y=0;y<256;y+=16){
      ctx.fillStyle='hsl('+Math.floor(y/256*150)+',45%,45%)'
      ctx.fillRect(0,y,512,16)
    }
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))
    if(!blob)throw new Error('Could not encode map fixture')
    const form=new FormData()
    form.append('file',new File([blob],'ci-globe.png',{type:'image/png'}))
    const response=await fetch('/api/workspaces/'+worldId+'/media',{method:'POST',body:form})
    if(!response.ok)throw new Error('Map media upload HTTP '+response.status+': '+await response.text())
    const result=await response.json()
    return result.asset.url
  },worldId)
  await requestOk(await desktop.request.post(BASE+'/api/workspaces/'+worldId+'/entities',{
    headers:{Origin:BASE},
    data:{
      kind:'worldEntry',title:'CI Globe World',
      data:{
        title:'CI Globe World',category:'地图',
        mapImage:mapImageUrl,mapWidth:512,mapHeight:256,
        mapSeed:1234,mapMode:'terrain',
        mapParams:JSON.stringify({kind:'world',width:1024,height:512}),
        mapViews:{terrain:mapImageUrl},
      },
    },
  }),'create cloud map')
  await openSection(desktopPage,worldId,'地图')
  const globeButton=desktopPage.getByRole('button',{name:'3D 地球'})
  await globeButton.waitFor({timeout:20000})
  assert(await globeButton.isEnabled(),'2:1 map did not enable WebGL globe mode')
  await globeButton.click()
  await desktopPage.getByTestId('cloud-globe-view').waitFor({timeout:20000})
  const globeCanvas=desktopPage.getByTestId('cloud-globe-canvas')
  await globeCanvas.waitFor({timeout:20000})
  // Some CI Chrome devices use a software WebGL fallback; canvas presence
  // is still verified and the user-visible WebGL support message remains.
  await globeCanvas.hover()
  await desktopPage.mouse.wheel(0,-160)
  await desktopPage.getByRole('button',{name:'平面地图'}).click()
  const profileButton=desktopPage.getByRole('button',{name:'取地形剖面'})
  assert(await profileButton.isEnabled(),'Generated map did not expose terrain sampling')
  await profileButton.click()
  const picker=desktopPage.getByTestId('cloud-profile-picker')
  await picker.waitFor({timeout:10000})
  await picker.click({position:{x:100,y:80}})
  await desktopPage.getByText(/选择剖面的终点/).waitFor()
  await picker.click({position:{x:260,y:140}})
  await desktopPage.getByRole('img',{name:'地形剖面'}).waitFor({timeout:90000})
  await desktopPage.getByRole('button',{name:'关闭剖面'}).click()
  process.stdout.write('Chromium browser acceptance passed: 3D globe, terrain profile, cloud original export tabs and scoped previews; desktop timeline export; stable avatar/editor submenus; mobile touch drag; two-device layout version conflict.\\n')
}
run().catch(async error => {
  process.stderr.write('Browser acceptance failed: ' + (error.stack || error) + '\n')
  for (const [page, name] of [[desktopPage, 'desktop-failure'], [mobilePage, 'mobile-failure']]) {
    if (page) await page.screenshot({ path: '/tmp/ocstudio-browser-' + name + '.png' }).catch(() => undefined)
  }
  process.exitCode = 1
}).finally(async () => { if (browser) await browser.close() })

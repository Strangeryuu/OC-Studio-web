'use strict'

const BASE = 'http://127.0.0.1:3000'
const PUBLIC_ORIGIN = 'http://localhost:3000'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function ready() {
  for (let n = 0; n < 100; n += 1) {
    try {
      const response = await fetch(BASE + '/login', { redirect: 'manual' })
      if (response.status === 200) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  throw new Error('Next.js Web server did not become ready')
}

async function run() {
  await ready()

  const guestPage = await fetch(BASE + '/', { redirect: 'manual' })
  assert([302, 303, 307, 308].includes(guestPage.status),
    'Guest must be redirected away from private dashboard; got HTTP ' + guestPage.status)
  assert((guestPage.headers.get('location') || '').includes('/login'),
    'Guest must be redirected to login')

  const guestApi = await fetch(BASE + '/api/workspaces')
  assert(guestApi.status === 401, 'Guest API access must be rejected')

  const login = await fetch(BASE + '/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: PUBLIC_ORIGIN },
    body: JSON.stringify({ email: 'ci-admin@example.test', password: 'CI_only_SecurePass_456789' }),
  })
  assert(login.status === 200, 'Admin login failed with HTTP ' + login.status + ': ' + await login.text())
  const cookies = login.headers.getSetCookie().map(entry => entry.split(';')[0])
  assert(cookies.length > 0, 'Login response must set a session cookie')
  const cookie = cookies.join('; ')
  if (process.env.CI_BROWSER_COOKIE_PATH) {
    // CI-only ephemeral session handoff. Never print credentials or upload this file.
    const { writeFile } = require('node:fs/promises')
    await writeFile(process.env.CI_BROWSER_COOKIE_PATH, cookie, { mode: 0o600 })
  }

  // Site role and invite-code registration: the Better Auth admin.createUser
  // endpoint may specify a role and therefore needs the user:set-role grant.
  const signIn = async(email,password) => {
    const response=await fetch(BASE+'/api/auth/sign-in/email',{
      method:'POST',headers:{'Content-Type':'application/json',Origin:PUBLIC_ORIGIN},
      body:JSON.stringify({email,password}),
    })
    assert(response.status===200,'New account could not sign in: '+response.status)
    return response.headers.getSetCookie().map(item=>item.split(';')[0]).join('; ')
  }
  const adminCreated=await fetch(BASE+'/api/auth/admin/create-user',{
    method:'POST',headers:{Cookie:cookie,Origin:PUBLIC_ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({
      name:'CI Admin Created',email:'ci-created@example.test',
      password:'CI_newUser_Password_456789',role:'user',
    }),
  })
  const adminCreatedResult=await adminCreated.json()
  assert(adminCreated.status===200 && adminCreatedResult.user?.email==='ci-created@example.test',
    'Admin createUser with explicit role failed: '+JSON.stringify(adminCreatedResult))
  const createdCookie=await signIn('ci-created@example.test','CI_newUser_Password_456789')
  const siteMail=await fetch(BASE+'/api/admin/mail',{headers:{Cookie:cookie}})
  assert(siteMail.status===200,'Admin cannot access mail settings')
  const mailSaved=await fetch(BASE+'/api/admin/mail',{method:'PUT',headers:{
    Cookie:cookie,Origin:PUBLIC_ORIGIN,'Content-Type':'application/json',
  },body:JSON.stringify({
    mode:'local',from:'noreply@ci.example.test',host:'',port:587,secure:false,username:'',
  })})
  assert(mailSaved.status===200,'Site admin cannot select local mail mode')
  const unauthorizedMailTest=await fetch(BASE+'/api/admin/mail/test',{
    method:'POST',headers:{Cookie:createdCookie,Origin:PUBLIC_ORIGIN},
  })
  assert(unauthorizedMailTest.status===403,'Ordinary user could send administrator test mail')
  const crossSiteMailTest=await fetch(BASE+'/api/admin/mail/test',{
    method:'POST',headers:{Cookie:cookie,Origin:'https://attacker.example'},
  })
  assert(crossSiteMailTest.status===403,'Cross-origin mail test was accepted')
  if(process.env.CI_MAIL_CAPTURE_PATH){
    const testMail=await fetch(BASE+'/api/admin/mail/test',{
      method:'POST',headers:{Cookie:cookie,Origin:PUBLIC_ORIGIN},
    })
    const response=await testMail.json()
    assert(testMail.status===200&&response.accepted&&response.to==='ci-admin@example.test',
      'Admin self-addressed test email failed: '+JSON.stringify(response))
    const {readFile}=require('node:fs/promises')
    const body=await readFile(process.env.CI_MAIL_CAPTURE_PATH,'utf8')
    assert(body.includes('To: ci-admin@example.test')&&body.includes('Subject: =?UTF-8?B?'),
      'Admin test mail was not captured by local sendmail')
    const throttled=await fetch(BASE+'/api/admin/mail/test',{
      method:'POST',headers:{Cookie:cookie,Origin:PUBLIC_ORIGIN},
    })
    assert(throttled.status===429,'Repeated admin test emails were not rate limited')
  }
  const mailPrivate=await fetch(BASE+'/api/admin/mail',{headers:{Cookie:createdCookie}})
  assert(mailPrivate.status===403,'Ordinary user accessed admin mail settings')

  const newInvite=await fetch(BASE+'/api/admin/registration-codes',{
    method:'POST',headers:{Cookie:cookie,Origin:PUBLIC_ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({label:'ci-invite',maxUses:1,expiresDays:7}),
  })
  assert(newInvite.status===201,'Site admin could not generate registration invite')
  const invite=(await newInvite.json()).code
  assert(/^[a-f0-9]{48}$/.test(invite),'Registration code format mismatch')
  const useInvite=()=>fetch(BASE+'/api/register',{
    method:'POST',headers:{Origin:PUBLIC_ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({
      name:'CI Invited User',email:'ci-invited@example.test',
      password:'CI_InvitationPass_789456',confirmPassword:'CI_InvitationPass_789456',inviteCode:invite,
    }),
  })
  const wrongMatch=await fetch(BASE+'/api/register',{
    method:'POST',headers:{Origin:PUBLIC_ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({name:'CI Invited User',email:'ci-invited@example.test',
      password:'CI_InvitationPass_789456',confirmPassword:'another_Password_789456',inviteCode:invite}),
  })
  assert(wrongMatch.status===400,'Mismatched password confirmation was accepted')
  const registration=await useInvite()
  assert(registration.status===201,'Invited registration failed')
  if(process.env.CI_MAIL_CAPTURE_PATH){
    const {readFile}=require('node:fs/promises')
    const welcome=await readFile(process.env.CI_MAIL_CAPTURE_PATH,'utf8')
    assert(welcome.includes('To: ci-invited@example.test')&&welcome.includes('欢迎注册 OC Studio'),
      'Welcome message was not delivered to the local mail capture')
  }
  assert((await useInvite()).status===400,'Consumed one-use invitation was accepted again')
  const invitedCookie=await signIn('ci-invited@example.test','CI_InvitationPass_789456')
  const unauthorizedCodes=await fetch(BASE+'/api/admin/registration-codes',{headers:{Cookie:invitedCookie}})
  assert(unauthorizedCodes.status===403,'Ordinary user accessed invitation management')
  const registeredWorld=await fetch(BASE+'/api/workspaces',{method:'POST',
    headers:{Cookie:invitedCookie,Origin:PUBLIC_ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({name:'CI Registered Private World'}),
  })
  assert(registeredWorld.status===201,'Invited user could not create a private world')
  const registeredWorldId=(await registeredWorld.json()).workspace.id
  const adminAcross=await fetch(BASE+'/api/workspaces/'+registeredWorldId,{headers:{Cookie:cookie}})
  assert(adminAcross.status===200,'Site administrator cannot inspect private user world')
  const privateMenu=await fetch(BASE+'/admin',{headers:{Cookie:invitedCookie},redirect:'manual'})
  assert(privateMenu.status===404,'Ordinary account accessed admin menu')
  const blockedAdmin=await fetch(BASE+'/api/admin/registration-codes',{
    method:'POST',headers:{Cookie:invitedCookie,Origin:PUBLIC_ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({maxUses:3}),
  })
  assert(blockedAdmin.status===403,'Ordinary user created invitation codes')

  const myWorkspaces = await fetch(BASE + '/api/workspaces', {
    headers: { Cookie: cookie },
  })
  assert(myWorkspaces.status === 200, 'Logged-in user could not list workspaces')

  const created = await fetch(BASE + '/api/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: PUBLIC_ORIGIN, Cookie: cookie },
    body: JSON.stringify({ name: 'CI Private World' }),
  })
  if (created.status !== 201) {
    throw new Error('Authenticated workspace creation failed HTTP ' + created.status + ': ' + await created.text())
  }
  const json = await created.json()
  assert(json.workspace?.id && json.workspace?.role === 'owner',
    'Workspace owner membership was not created')
  const workspaceId = json.workspace.id
  // Owner-issued public sharing: anonymous read-only access and immediate revocation.
  const shareEndpoint=BASE+'/api/workspaces/'+workspaceId+'/public-share'
  const collaboratorShare=await fetch(shareEndpoint,{
    method:'POST',headers:{Cookie:invitedCookie,Origin:PUBLIC_ORIGIN},
  })
  assert(collaboratorShare.status===404,'A collaborator shared another user\'s workspace')
  const createdShare=await fetch(shareEndpoint,{
    method:'POST',headers:{Cookie:cookie,Origin:PUBLIC_ORIGIN},
  })
  assert(createdShare.status===201,'Workspace owner could not create a public link')
  const guestPath=(await createdShare.json()).path
  assert(/^\/share\/[a-f0-9]{64}$/.test(guestPath),'Public link format is invalid')
  const publicGuestResponse=await fetch(BASE+guestPath,{redirect:'manual'})
  assert(publicGuestResponse.status===200,'Anonymous share page did not open')
  const guestHtml=await publicGuestResponse.text()
  assert(guestHtml.includes('CI Private World')&&guestHtml.includes('游客只读'),
    'Anonymous share page did not display public workspace in read-only mode')
  const anonymousWrite=await fetch(BASE+'/api/workspaces/'+workspaceId+'/entities',{
    method:'POST',headers:{Origin:PUBLIC_ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({kind:'character',title:'Unapproved',data:{name:'Unapproved'}}),
  })
  assert(anonymousWrite.status===401,'Anonymous visitor gained workspace write permissions')
  const revokedShare=await fetch(shareEndpoint,{
    method:'DELETE',headers:{Cookie:cookie,Origin:PUBLIC_ORIGIN},
  })
  assert(revokedShare.status===200,'Owner could not revoke public link')
  assert((await fetch(BASE+guestPath,{redirect:'manual'})).status===404,
    'Revoked public share link remained available')
  const privateToInvited=await fetch(BASE+'/api/workspaces/'+workspaceId,{headers:{Cookie:invitedCookie}})
  assert(privateToInvited.status===404,'Private workspace leaked to non-invited ordinary user')
  const adminSeesAll=await fetch(BASE+'/api/workspaces',{headers:{Cookie:cookie}})
  const adminWorkspaces=(await adminSeesAll.json()).workspaces
  assert(adminWorkspaces.some(item=>item.id===registeredWorldId),
    'Site admin global workspace listing failed')


  const privateApi = await fetch(BASE + '/api/workspaces/' + workspaceId)
  assert(privateApi.status === 401, 'Guest gained access to private workspace')
  const authorizedApi = await fetch(BASE + '/api/workspaces/' + workspaceId, {
    headers: { Cookie: cookie },
  })
  assert(authorizedApi.status === 200, 'Owner was unable to access their workspace')

  const guestConfig = await fetch(BASE + '/api/workspaces/' + workspaceId + '/character-config')
  assert(guestConfig.status === 401, 'Guest accessed private character template')

  const templateResponse = await fetch(BASE + '/api/workspaces/' + workspaceId + '/character-config', {
    headers: { Cookie: cookie },
  })
  assert(templateResponse.status === 200, 'Owner could not view their character config')
  const initialTemplate = await templateResponse.json()
  assert(initialTemplate.version === 0, 'Fresh workspace should have default character config version 0')
  assert(initialTemplate.config.fields.some(field => field.id === 'occupation'), 'Upstream occupation field missing')
  assert(initialTemplate.config.components.some(component => component.id === 'body'), 'Character body missing')

  const newTemplate = {
    ...initialTemplate.config,
    fields: [
      { id: 'f_ci_ability', key: '能力设定', label: '能力', type: 'text' },
      ...initialTemplate.config.fields,
    ],
  }
  const saveConfig = await fetch(BASE + '/api/workspaces/' + workspaceId + '/character-config', {
    method: 'PATCH',
    headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 0, config: newTemplate }),
  })
  assert(saveConfig.status === 200, 'Owner character config save failed HTTP ' + saveConfig.status)
  const savedTemplate = await saveConfig.json()
  assert(savedTemplate.version === 1, 'Cloud character config revision should increment')

  const staleConfig = await fetch(BASE + '/api/workspaces/' + workspaceId + '/character-config', {
    method: 'PATCH',
    headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 0, config: newTemplate }),
  })
  assert(staleConfig.status === 409, 'Concurrent template update should return HTTP 409')

  const forbiddenTemplateOrigin = await fetch(BASE + '/api/workspaces/' + workspaceId + '/character-config', {
    method: 'PATCH',
    headers: { Cookie: cookie, Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 1, config: newTemplate }),
  })
  assert(forbiddenTemplateOrigin.status === 403, 'Cross-site template mutation should be forbidden')


  // Media is private and its identifiers must remain within their workspace.
  const form = new FormData()
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/1tkAAAAASUVORK5CYII=',
    'base64',
  )
  form.set('file', new Blob([tinyPng], { type: 'image/png' }), 'tiny.png')
  const uploaded = await fetch(BASE + '/api/workspaces/' + workspaceId + '/media', {
    method: 'POST', headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN }, body: form,
  })
  assert(uploaded.status === 201, 'Workspace media upload failed HTTP ' + uploaded.status)
  const asset = (await uploaded.json()).asset
  assert(asset?.id, 'Media must have a UUID')
  const guestMedia = await fetch(BASE + '/api/media/' + asset.id)
  assert(guestMedia.status === 401, 'Private character image leaked to guests')
  const ownMedia = await fetch(BASE + '/api/media/' + asset.id, {
    headers: { Cookie: cookie },
  })
  assert(ownMedia.status === 200, 'Owner could not read private image')
  assert((await ownMedia.arrayBuffer()).byteLength === tinyPng.length, 'Private media bytes changed')

  const character = {
    kind: 'character', title: 'CI 角色',
    data: {
      name: 'CI 角色', avatarMediaId: asset.id, headerMediaId: asset.id,
      portraitMediaIds: [asset.id], galleryMediaIds: [asset.id],
      cloudTags: ['主角', '设定'], document: { type: 'doc', content: [{ type: 'paragraph' }] },
    },
  }
  const createdCharacter = await fetch(BASE + '/api/workspaces/' + workspaceId + '/entities', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify(character),
  })
  assert(createdCharacter.status === 201, 'Character with private cloud images failed creation')
  const createdEntity = await createdCharacter.json()
  const entityId = createdEntity.entity?.id
  assert(entityId, 'Character creation did not return an entity id')

  const patched = await fetch(BASE + '/api/entities/' + entityId, {
    method: 'PATCH',
    headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'CI 角色更新', expectedVersion: 1,
      data: { ...character.data, cloudTags: ['主角', '更新'] } }),
  })
  assert(patched.status === 200, 'Character history update failed HTTP ' + patched.status)
  const changed = await patched.json()
  assert(changed.version === 2, 'Character revisions must increment')

  const history = await fetch(BASE + '/api/entities/' + entityId + '/revisions', {
    headers: { Cookie: cookie },
  })
  assert(history.status === 200 && (await history.json()).revisions.length === 2,
    'Character revisions were not recorded')

  const anotherWorld = await fetch(BASE + '/api/workspaces', {
    method: 'POST', headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'CI Other World' }),
  })
  assert(anotherWorld.status === 201, 'Second workspace setup failed')
  const otherId = (await anotherWorld.json()).workspace.id
  const foreignMedia = await fetch(BASE + '/api/workspaces/' + otherId + '/entities', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify(character),
  })
  assert(foreignMedia.status === 400, 'Character must reject an image from another workspace')


  // Map lifecycle through real Better Auth sessions and a standalone PostgreSQL server.
  const mapHeaders = { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' }
  const mapTitle = 'CI 地图跨库同名'
  const newMapPayload = {
    kind: 'worldEntry', title: mapTitle,
    data: {
      title: mapTitle, category: '地图',
      mapImage: '/api/media/' + asset.id, mapWidth: 1, mapHeight: 1,
      mapMode: 'terrain', mapViews: { terrain: '/api/media/' + asset.id },
      mapAnnotations: JSON.stringify([{ id: 'ci-road', kind: 'road',
        points: [{x:0.1,y:0.2},{x:0.8,y:0.8}], color: '松绿' }]),
    },
  }
  const createMap = await fetch(BASE + '/api/workspaces/' + workspaceId + '/entities', {
    method: 'POST', headers: mapHeaders, body: JSON.stringify(newMapPayload),
  })
  const mapCreateBody = await createMap.json()
  assert(createMap.status === 201, 'Creating map with current workspace media failed: ' + JSON.stringify(mapCreateBody))
  const mapEntityId = mapCreateBody.entity?.id
  assert(mapEntityId, 'Map did not return a versioned entity id')

  const duplicateMap = await fetch(BASE + '/api/workspaces/' + workspaceId + '/entities', {
    method: 'POST', headers: mapHeaders, body: JSON.stringify(newMapPayload),
  })
  assert(duplicateMap.status === 400, 'Duplicate map title within workspace must be rejected')

  const foreignMap = await fetch(BASE + '/api/workspaces/' + otherId + '/entities', {
    method: 'POST', headers: mapHeaders, body: JSON.stringify({
      ...newMapPayload, data: { title: mapTitle, category: '地图' },
    }),
  })
  assert(foreignMap.status === 201, 'A second workspace must allow the same map title')

  const pinCreate = await fetch(BASE + '/api/workspaces/' + workspaceId + '/entities', {
    method: 'POST', headers: mapHeaders, body: JSON.stringify({
      kind: 'country', title: 'CI 云端国家',
      data: { name: 'CI 云端国家', mapId: mapTitle, mapPosition: { x: 0.3, y: 0.5 } },
    }),
  })
  const pinBody = await pinCreate.json()
  assert(pinCreate.status === 201, 'Country map anchor creation failed: ' + JSON.stringify(pinBody))
  const countryEntityId = pinBody.entity?.id
  assert(countryEntityId, 'Mapped country returned no entity ID')

  const renamedMapTitle = mapTitle + '-改名'
  const renameMap = await fetch(BASE + '/api/workspaces/' + workspaceId + '/maps/' + mapEntityId, {
    method: 'PATCH', headers: mapHeaders,
    body: JSON.stringify({ expectedVersion: 1, name: renamedMapTitle }),
  })
  const renameResult = await renameMap.json()
  assert(renameMap.status === 200, 'Cloud map rename with pin cascade failed: ' + JSON.stringify(renameResult))
  assert(renameResult.version === 2 && renameResult.renamedPins === 1,
    'Map rename must version both the map and the linked country')
  const staleMap = await fetch(BASE + '/api/workspaces/' + workspaceId + '/maps/' + mapEntityId, {
    method: 'PATCH', headers: mapHeaders,
    body: JSON.stringify({ expectedVersion: 1, name: '过期改名' }),
  })
  assert(staleMap.status === 409, 'Stale map rename must be rejected')

  const linkedCountry = await fetch(BASE + '/api/entities/' + countryEntityId, {
    headers: { Cookie: cookie },
  })
  assert(linkedCountry.status === 200, 'Renamed map country could not be read')
  const linkedContent = (await linkedCountry.json()).entity?.content
  assert(linkedContent?.mapId === renamedMapTitle, 'Map rename did not cascade to country mapId')
  const linkedHistory = await fetch(BASE + '/api/entities/' + countryEntityId + '/revisions', {
    headers: { Cookie: cookie },
  })
  assert(linkedHistory.status === 200 && (await linkedHistory.json()).revisions.length === 2,
    'Pin cascade revision missing')

  const removeMap = await fetch(BASE + '/api/workspaces/' + workspaceId + '/maps/' + mapEntityId, {
    method: 'DELETE', headers: mapHeaders, body: JSON.stringify({ expectedVersion: 2 }),
  })
  assert(removeMap.status === 200 && (await removeMap.json()).removedPins === 1,
    'Map deletion must clear the linked country anchor')
  const countryAfterDelete = await fetch(BASE + '/api/entities/' + countryEntityId, {
    headers: { Cookie: cookie },
  })
  const cleared = (await countryAfterDelete.json()).entity?.content
  assert(cleared?.mapId === null && cleared?.mapPosition === null,
    'Deleting the map left an orphaned country anchor')


  // Novel books, chapters, media and deletion use the same real PostgreSQL HTTP service.
  const novelTitle = 'CI 云端小说'
  const createNovel = (workspace, title, data) => fetch(BASE + '/api/workspaces/' + workspace + '/entities', {
    method: 'POST', headers: mapHeaders,
    body: JSON.stringify({ kind: 'worldEntry', title, data: { title, category: '小说', ...data } }),
  })
  const novelResponse = await createNovel(workspaceId, novelTitle, {
    parentId: null, order: 5, novelAuthor: '测试作者', novelSynopsis: '小说简介',
    novelCover: '/api/media/' + asset.id,
  })
  const novelBody = await novelResponse.json()
  assert(novelResponse.status === 201, 'Novel book creation failed: ' + JSON.stringify(novelBody))
  const bookId = novelBody.entity.id
  const bookLocalId = novelBody.entity.local_id

  const foreignBook = await createNovel(otherId, novelTitle, { parentId: null, order: 6 })
  assert(foreignBook.status === 201, 'A second workspace should support the same novel title')
  const foreignBookData = await foreignBook.json()
  const outsiderChapter = await createNovel(workspaceId, '跨库非法章节', {
    parentId: foreignBookData.entity.local_id, order: 10,
  })
  assert(outsiderChapter.status === 400, 'A chapter may only reference a book in its workspace')

  const chapterResponse = await createNovel(workspaceId, '第一章', {
    parentId: bookLocalId, order: 11,
    document: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '世界观小说正文' }] },
    ] },
  })
  const chapterData = await chapterResponse.json()
  assert(chapterResponse.status === 201, 'Chapter creation failed: ' + JSON.stringify(chapterData))
  const chapterId = chapterData.entity.id
  const nested = await createNovel(workspaceId, '第一节', {
    parentId: chapterData.entity.local_id, order: 12,
  })
  assert(nested.status === 201, 'Novel subchapter creation failed')

  const illegalDelete = await fetch(BASE + '/api/entities/' + bookId, {
    method: 'DELETE', headers: mapHeaders,
    body: JSON.stringify({ expectedVersion: 1 }),
  })
  assert(illegalDelete.status === 400, 'Generic entity removal must not strand novel chapters')
  const staleNovel = await fetch(BASE + '/api/workspaces/' + workspaceId + '/novels/' + bookId, {
    method: 'DELETE', headers: mapHeaders, body: JSON.stringify({ expectedVersion: 2 }),
  })
  assert(staleNovel.status === 409, 'Stale novel version must be rejected')
  const deletedNovel = await fetch(BASE + '/api/workspaces/' + workspaceId + '/novels/' + bookId, {
    method: 'DELETE', headers: mapHeaders, body: JSON.stringify({ expectedVersion: 1 }),
  })
  const deletedNovelData = await deletedNovel.json()
  assert(deletedNovel.status === 200 && deletedNovelData.removedEntries === 3,
    'Novel removal must atomically delete its chapter subtree: ' + JSON.stringify(deletedNovelData))
  const deletedChapter = await fetch(BASE + '/api/entities/' + chapterId, {
    headers: { Cookie: cookie },
  })
  assert(deletedChapter.status === 404, 'Deleted novel chapter remains readable')

  // Advanced original novel DnD order and table parent promotion on real PostgreSQL.
  const orderedBook = await createNovel(workspaceId, 'CI 排序小说', {parentId:null,order:0})
  assert(orderedBook.status === 201, 'Novel reorder setup book failed')
  const orderedRoot = (await orderedBook.json()).entity
  const orderedChapters = []
  for (const [index,title] of ['前章','中章','末章'].entries()) {
    const created = await createNovel(workspaceId,title,{parentId:orderedRoot.local_id,order:index})
    assert(created.status===201, 'Novel reorder chapter setup failed')
    orderedChapters.push((await created.json()).entity)
  }
  const [firstChapter,secondChapter,lastChapter] = orderedChapters
  const reorderVersions = Object.fromEntries(orderedChapters.map(item=>[String(item.local_id),item.version]))
  const reorderUrl = BASE+'/api/workspaces/'+workspaceId+'/novels/'+orderedRoot.id+'/reorder'
  const invalidReorder = await fetch(reorderUrl,{method:'PATCH',headers:mapHeaders,
    body:JSON.stringify({draggedId:lastChapter.local_id,overId:foreignBookData.entity.local_id,
      expectedVersions:reorderVersions})})
  assert(invalidReorder.status===400,'Novel drag across books must be refused')
  const changedReorder = await fetch(reorderUrl,{method:'PATCH',headers:mapHeaders,
    body:JSON.stringify({draggedId:lastChapter.local_id,overId:firstChapter.local_id,
      expectedVersions:reorderVersions})})
  const reorderResult=await changedReorder.json()
  assert(changedReorder.status===200&&reorderResult.updated===3,
    'Original novel ordering transaction failed: '+JSON.stringify(reorderResult))
  const staleReorder = await fetch(reorderUrl,{method:'PATCH',headers:mapHeaders,
    body:JSON.stringify({draggedId:firstChapter.local_id,overId:lastChapter.local_id,
      expectedVersions:reorderVersions})})
  assert(staleReorder.status===409,'Novel reorder must reject concurrent stale versions')
  const readSorted = await fetch(BASE+'/api/entities/'+lastChapter.id,{headers:{Cookie:cookie}})
  assert(readSorted.status===200,'Reordered chapter is missing')
  assert((await readSorted.json()).entity.content.order===0,'Reordered chapter order was not persisted')

  const createTableEntity = async(kind,title,data) => {
    const response=await fetch(BASE+'/api/workspaces/'+workspaceId+'/entities',{
      method:'POST',headers:mapHeaders,
      body:JSON.stringify({kind,title,data}),
    })
    assert(response.status===201,'Table fixture creation failed for '+kind+': '+response.status)
    return (await response.json()).entity
  }
  const tableCountry = await createTableEntity('country','CI 表格父国家',{name:'CI 表格父国家'})
  const tableChild = await createTableEntity('country','CI 表格子国家',{
    name:'CI 表格子国家',parentId:tableCountry.local_id,
  })
  const tableMember = await createTableEntity('character','CI 表格成员',{
    name:'CI 表格成员',countryId:tableCountry.local_id,
  })
  const tableEvent = await createTableEntity('event','CI 表格事件',{
    title:'CI 表格事件',countries:[tableCountry.local_id],
  })
  const tableVersions = Object.fromEntries([tableCountry,tableChild,tableMember,tableEvent]
    .map(item=>[item.id,item.version]))
  const tableUrl=BASE+'/api/workspaces/'+workspaceId+'/table/'+tableCountry.id
  const staleTable = await fetch(tableUrl,{method:'DELETE',headers:mapHeaders,
    body:JSON.stringify({expectedVersion:1,expectedVersions:{}})})
  assert(staleTable.status===409,'Table delete must check all dependent revisions')
  const tableRemoval=await fetch(tableUrl,{method:'DELETE',headers:mapHeaders,
    body:JSON.stringify({expectedVersion:1,expectedVersions:tableVersions})})
  const tableResult=await tableRemoval.json()
  assert(tableRemoval.status===200&&tableResult.promotedOrUnlinked===3,
    'Original table delete cascade failed: '+JSON.stringify(tableResult))
  const promotedRow=await fetch(BASE+'/api/entities/'+tableChild.id,{headers:{Cookie:cookie}})
  assert(promotedRow.status===200&&(await promotedRow.json()).entity.content.parentId===null,
    'Child country was not promoted to the previous parent')
  const clearedMember=await fetch(BASE+'/api/entities/'+tableMember.id,{headers:{Cookie:cookie}})
  assert(clearedMember.status===200&&(await clearedMember.json()).entity.content.countryId===null,
    'Country membership was not cleared')
  const clearedEvent=await fetch(BASE+'/api/entities/'+tableEvent.id,{headers:{Cookie:cookie}})
  assert(clearedEvent.status===200&&(await clearedEvent.json()).entity.content.countries.length===0,
    'Deleted country remained in event references')

  // Tags have stable UUIDs; renaming one does not require rewriting characters.
  const tagResponse = await fetch(BASE + '/api/workspaces/' + workspaceId + '/tags', {
    method: 'POST', headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '主角', color: '#4ecdc4' }),
  })
  assert(tagResponse.status === 201, 'Shared tag creation failed HTTP ' + tagResponse.status)
  const tagId = (await tagResponse.json()).tag.id

  const duplicateTag = await fetch(BASE + '/api/workspaces/' + workspaceId + '/tags', {
    method: 'POST', headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '主角', color: '#4ecdc4' }),
  })
  assert(duplicateTag.status === 409, 'Duplicate shared tags should be rejected')

  const foreignTagResponse = await fetch(BASE + '/api/workspaces/' + otherId + '/tags', {
    method: 'POST', headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '其他世界的标签', color: '#4ecdc4' }),
  })
  assert(foreignTagResponse.status === 201, 'Foreign tag test setup failed')
  const foreignTagId = (await foreignTagResponse.json()).tag.id

  const sibling = await fetch(BASE + '/api/workspaces/' + workspaceId + '/entities', {
    method: 'POST', headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'character', title: 'CI 表姐',
      data: { name: 'CI 表姐', document: { type: 'doc', content: [{ type: 'paragraph' }] } } }),
  })
  assert(sibling.status === 201, 'Creating related character failed')
  const siblingId = (await sibling.json()).entity.id
  const otherCharacter = await fetch(BASE + '/api/workspaces/' + otherId + '/entities', {
    method: 'POST', headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'character', title: 'Other World Character',
      data: { name: 'Other World Character' } }),
  })
  assert(otherCharacter.status === 201, 'Foreign character test setup failed')
  const otherCharacterId = (await otherCharacter.json()).entity.id

  const relation = {
    id: '00000000-0000-4000-8000-000000000001',
    targetId: siblingId, relation: '表姐', arrow: 'both',
  }
  const linkedDocument = {
    ...character.data, cloudTagIds: [tagId], cloudRelations: [relation],
  }
  const linkSave = await fetch(BASE + '/api/entities/' + entityId, {
    method: 'PATCH', headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'CI 角色更新', expectedVersion: 2, data: linkedDocument }),
  })
  assert(linkSave.status === 200, 'Saving shared tags/character relation failed HTTP ' + linkSave.status)
  assert((await linkSave.json()).version === 3, 'Relationship update must create a revision')
  const updatedEntity = await fetch(BASE + '/api/entities/' + entityId, { headers: { Cookie: cookie } })
  assert(updatedEntity.status === 200, 'Linked character read failed')
  const entityData = (await updatedEntity.json()).entity.content
  assert(entityData.cloudRelations[0].targetId === siblingId && entityData.cloudTagIds[0] === tagId,
    'Saved relationship or tag references are missing')

  const tagRename = await fetch(BASE + '/api/workspaces/' + workspaceId + '/tags/' + tagId, {
    method: 'PATCH', headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '核心人物', color: '#45b7d1' }),
  })
  assert(tagRename.status === 200, 'Workspace tag rename failed')
  const tagList = await fetch(BASE + '/api/workspaces/' + workspaceId + '/tags', {
    headers: { Cookie: cookie },
  })
  assert(tagList.status === 200, 'Private tag list failed')
  assert((await tagList.json()).tags.some(tag => tag.id === tagId && tag.name === '核心人物'),
    'Shared tag rename lost the stable tag id')

  const guestTags = await fetch(BASE + '/api/workspaces/' + workspaceId + '/tags')
  assert(guestTags.status === 401, 'Guest could read private workspace tags')
  const foreignRelation = await fetch(BASE + '/api/entities/' + entityId, {
    method: 'PATCH', headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'CI 角色更新', expectedVersion: 3, data: {
      ...linkedDocument, cloudRelations: [{ ...relation, targetId: otherCharacterId }],
    } }),
  })
  assert(foreignRelation.status === 400, 'Cross-workspace relationship should be rejected')
  const foreignTag = await fetch(BASE + '/api/entities/' + entityId, {
    method: 'PATCH', headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'CI 角色更新', expectedVersion: 3, data: {
      ...linkedDocument, cloudTagIds: [foreignTagId],
    } }),
  })
  assert(foreignTag.status === 400, 'Cross-workspace shared tag should be rejected')
  const selfRelation = await fetch(BASE + '/api/entities/' + entityId, {
    method: 'PATCH', headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'CI 角色更新', expectedVersion: 3, data: {
      ...linkedDocument, cloudRelations: [{ ...relation, targetId: entityId }],
    } }),
  })
  assert(selfRelation.status === 400, 'Self-referencing relationship should be rejected')

  // Cloud React Flow writes original numeric graph fields using the same
  // versioned entity PATCH endpoint as every editor. Verify create/delete,
  // persistence, concurrent-write rejection, and revision history in PostgreSQL.
  const graphPayload = name => ({
    kind:'character',title:name,data:{
      name,aliases:[],race:'',element:'',occupation:'',faction:'',
      nationalityLegacy:'',height:'',birthday:'',avatarUrl:'',
      bio:'',lifeStory:'',relatedCharacters:[],relatedNotes:[],
      gallery:[],avatars:[],tags:[],deleted:false,
      createdAt:Date.now(),updatedAt:Date.now(),_syncStatus:'synced',_lastModified:Date.now(),
    },
  })
  const graphCreate = async name => {
    const response=await fetch(BASE+'/api/workspaces/'+workspaceId+'/entities',{
      method:'POST',headers:{Cookie:cookie,Origin:PUBLIC_ORIGIN,'Content-Type':'application/json'},
      body:JSON.stringify(graphPayload(name)),
    })
    assert(response.status===201,'Cloud graph node could not be created: '+response.status)
    return (await response.json()).entity
  }
  const graphLeft=await graphCreate('CI 图谱来源')
  const graphRight=await graphCreate('CI 图谱目标')
  const graphTarget=await fetch(BASE+'/api/entities/'+graphRight.id,{headers:{Cookie:cookie}})
  const graphTargetLocalId=(await graphTarget.json()).entity.local_id
  assert(Number.isSafeInteger(graphTargetLocalId),'Cloud graph target has no numeric local id')
  const graphLink={...graphPayload('CI 图谱来源').data,relatedCharacters:[
    {characterId:graphTargetLocalId,name:'CI 图谱目标',relation:'盟友',arrow:'both'},
  ]}
  const saveGraphLink=await fetch(BASE+'/api/entities/'+graphLeft.id,{
    method:'PATCH',headers:{Cookie:cookie,Origin:PUBLIC_ORIGIN,
      'Content-Type':'application/json','X-OC-Workspace-Id':workspaceId},
    body:JSON.stringify({title:'CI 图谱来源',expectedVersion:1,data:graphLink}),
  })
  assert(saveGraphLink.status===200&&(await saveGraphLink.json()).version===2,
    'Cloud graph relationship creation did not persist as version 2')
  const graphSaved=await fetch(BASE+'/api/entities/'+graphLeft.id,{headers:{Cookie:cookie}})
  assert((await graphSaved.json()).entity.content.relatedCharacters[0].relation==='盟友',
    'Cloud graph relationship was not readable through original entity projection')
  const graphStale=await fetch(BASE+'/api/entities/'+graphLeft.id,{
    method:'PATCH',headers:{Cookie:cookie,Origin:PUBLIC_ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({title:'CI 图谱来源',expectedVersion:1,data:graphLink}),
  })
  assert(graphStale.status===409,'Concurrent cloud graph relation overwrite was accepted')
  const removeGraphLink=await fetch(BASE+'/api/entities/'+graphLeft.id,{
    method:'PATCH',headers:{Cookie:cookie,Origin:PUBLIC_ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({title:'CI 图谱来源',expectedVersion:2,
      data:{...graphLink,relatedCharacters:[]}}),
  })
  assert(removeGraphLink.status===200&&(await removeGraphLink.json()).version===3,
    'Cloud graph relationship removal did not persist')
  const graphHistory=await fetch(BASE+'/api/entities/'+graphLeft.id+'/revisions',{
    headers:{Cookie:cookie},
  })
  assert(graphHistory.status===200&&(await graphHistory.json()).revisions.length===3,
    'Cloud graph relationship revisions were not recorded')

  const graphMediaUrl='/api/media/'+asset.id
  const graphWithImageAndPosition={...graphLink,relatedCharacters:[],
    avatarUrl:graphMediaUrl,graphPosition:{x:176.5,y:92.3}}
  const graphImageSave=await fetch(BASE+'/api/entities/'+graphLeft.id,{
    method:'PATCH',headers:{Cookie:cookie,Origin:PUBLIC_ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({title:'CI 图谱来源',expectedVersion:3,data:graphWithImageAndPosition}),
  })
  assert(graphImageSave.status===200&&(await graphImageSave.json()).version===4,
    'Graph node image or dragged position did not save via versioned entity')
  const graphImageRead=await fetch(BASE+'/api/entities/'+graphLeft.id,{headers:{Cookie:cookie}})
  const graphImageRecord=(await graphImageRead.json()).entity.content
  assert(graphImageRecord.avatarUrl===graphMediaUrl&&graphImageRecord.graphPosition.x===176.5 &&
    graphImageRecord.graphPosition.y===92.3,'Graph position or private node image was not preserved')
  const graphUndoSave=await fetch(BASE+'/api/entities/'+graphLeft.id,{
    method:'PATCH',headers:{Cookie:cookie,Origin:PUBLIC_ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({title:'CI 图谱来源',expectedVersion:4,
      data:{...graphWithImageAndPosition,graphPosition:{x:0,y:0}}}),
  })
  assert(graphUndoSave.status===200&&(await graphUndoSave.json()).version===5,
    'Graph undo coordinates were not versioned')
  const graphExpandedHistory=await fetch(BASE+'/api/entities/'+graphLeft.id+'/revisions',{
    headers:{Cookie:cookie},
  })
  assert(graphExpandedHistory.status===200&&
    (await graphExpandedHistory.json()).revisions.length===5,
    'Graph media, position and undo changes were missing from history')


  // Acceptance: real PostgreSQL + logged-in HTTP lifecycle for all four advanced modules.
  // Independent workspaces ensure backup restore cannot overwrite an existing library.
  const makeWorld = async name => {
    const response = await fetch(BASE + '/api/workspaces', {
      method: 'POST', headers: mapHeaders, body: JSON.stringify({ name }),
    })
    if (response.status !== 201) {
      throw new Error('Advanced acceptance workspace creation failed HTTP ' +
        response.status + ': ' + await response.text())
    }
    return (await response.json()).workspace.id
  }
  const sourceWorld = await makeWorld('CI Advanced Source')
  const restoreWorld = await makeWorld('CI Advanced Restore')
  const sourceUrl = '/api/workspaces/' + sourceWorld
  const targetUrl = '/api/workspaces/' + restoreWorld
  const scoped = (world, path, options = {}) => fetch(BASE + '/api/workspaces/' + world + path, {
    headers: { Cookie: cookie }, ...options,
  })
  const scopedMutation = (world, path, method, body) => scoped(world, path, {
    method, headers: mapHeaders, body: JSON.stringify(body),
  })
  const customize = await scoped(sourceWorld, '/customization')
  const initialCustom = await customize.json()
  assert(customize.status === 200 && initialCustom.version === 0,
    'Original workspace customization was not accessible')
  const advancedCategories = {
    ...initialCustom.customization,
    categories: [...initialCustom.customization.categories,
      { id: 'cat-ci-acceptance', name: '迁移文物', template: 'entry',
        icon: 'book', order: 50, enabled: true }],
  }
  const changedCustom = await scopedMutation(sourceWorld, '/customization', 'PUT', {
    expectedVersion: 0, customization: advancedCategories,
  })
  assert(changedCustom.status === 200,
    'Original customization save failed: ' + await changedCustom.text())
  assert((await scopedMutation(sourceWorld, '/customization', 'PUT', {
    expectedVersion: 0, customization: advancedCategories,
  })).status === 409, 'Stale customization revision was accepted')
  const foreignSettings = await scoped(restoreWorld, '/customization')
  assert((await foreignSettings.json()).version === 0,
    'Customization leaked between workspaces')

  const makeEntry = async(kind, title, data) => {
    const response = await scopedMutation(sourceWorld, '/entities', 'POST', { kind, title, data })
    const payload = await response.json()
    assert(response.status === 201,
      'Advanced acceptance create failed: ' + JSON.stringify({kind,title,payload}))
    return payload.entity
  }
  const sourceCountry = await makeEntry('country', '迁移王国', { name:'迁移王国' })
  const sourcePictureForm = new FormData()
  sourcePictureForm.set('file', new Blob([tinyPng], { type:'image/png' }), 'transfer.png')
  const sourceUpload = await fetch(BASE + sourceUrl + '/media', {
    method:'POST',headers:{Cookie:cookie,Origin:PUBLIC_ORIGIN},body:sourcePictureForm,
  })
  assert(sourceUpload.status === 201, 'Backup source media upload failed')
  const sourceAsset = (await sourceUpload.json()).asset
  const sourceCharacter = await makeEntry('character','迁移守护者',{
    name:'迁移守护者', countryId:sourceCountry.local_id,
    avatarUrl:'/api/media/'+sourceAsset.id,
  })
  const sourceCodex = await makeEntry('worldEntry','迁移古卷',{
    title:'迁移古卷',category:'迁移文物',parentId:null,summary:'星石铭文',
  })
  const sourceBook = await makeEntry('worldEntry','迁移史诗',{
    title:'迁移史诗',category:'小说',parentId:null,
  })
  const sourceChapter = await makeEntry('worldEntry','迁移第一章',{
    title:'迁移第一章',category:'小说',parentId:sourceBook.local_id,order:1,
  })
  const searchSource = await scoped(sourceWorld, '/search?q='+encodeURIComponent('迁移'))
  assert(searchSource.status === 200, 'Authenticated advanced search failed')
  const sourceHits = (await searchSource.json()).hits
  assert(sourceHits.some(hit => hit.entityId === sourceCodex.id && hit.kind === 'world') &&
    sourceHits.some(hit => hit.entityId === sourceBook.id && hit.kind === 'novel') &&
    sourceHits.some(hit => hit.entityId === sourceCharacter.id && hit.kind === 'character'),
    'Cross-entity cloud search missed original content')
  const searchedForeign = await scoped(restoreWorld, '/search?q='+encodeURIComponent('迁移'))
  assert((await searchedForeign.json()).hits.length === 0,
    'Search returned another workspace\'s private content')

  const trashPath = '/trash/' + sourceBook.id
  const removeSourceBook = await scopedMutation(sourceWorld, '/novels/'+sourceBook.id,
    'DELETE', {expectedVersion:1})
  assert(removeSourceBook.status === 200 &&
    (await removeSourceBook.json()).removedEntries === 2,
    'Book removal did not soft-delete the complete original chapter tree')
  const trashList = await scoped(sourceWorld, '/trash')
  assert((await trashList.json()).items.some(item => item.id === sourceBook.id),
    'Soft-deleted book is missing from authenticated recycle bin')
  const restoreSourceBook = await scopedMutation(sourceWorld, trashPath,'POST',{expectedVersion:2})
  assert(restoreSourceBook.status === 200 && (await restoreSourceBook.json()).items === 2,
    'Original book and chapter tree could not be restored together')
  const restoredChapter = await fetch(BASE+'/api/entities/'+sourceChapter.id,{headers:{Cookie:cookie}})
  assert(restoredChapter.status === 200 &&
    (await restoredChapter.json()).entity.content.parentId === sourceBook.local_id,
    'Original chapter parent ID was lost in recycle-bin restore')
  const removeAgain = await scopedMutation(sourceWorld,'/novels/'+sourceBook.id,
    'DELETE',{expectedVersion:3})
  assert(removeAgain.status === 200,'Book setup for deleted backup snapshot failed')

  const backupBefore = await scoped(sourceWorld,'/backup')
  assert(backupBefore.status === 200,'Cloud export failed HTTP '+backupBefore.status)
  const backupJson = await backupBefore.text()
  const archive = JSON.parse(backupJson)
  assert(archive.version === 1 && archive.cloud.format === 'oc-studio-web-v1' &&
    archive.cloud.records.length === 5 && archive.cloud.assets.length === 1,
    'Portable cloud backup is missing versioned records or media')
  const foreignBackup = await scoped(restoreWorld,'/backup')
  assert((await foreignBackup.json()).cloud.records.length === 0,
    'Backup leaked content into a new workspace')
  assert((await fetch(BASE+targetUrl+'/backup',{
    method:'POST',headers:{Cookie:cookie,Origin:'https://attacker.invalid',
      'Content-Type':'application/json'},body:backupJson,
  })).status === 403,'Cross-origin backup import was allowed')
  assert((await fetch(BASE+targetUrl+'/backup',{
    method:'POST',headers:{Origin:PUBLIC_ORIGIN,'Content-Type':'application/json'},body:backupJson,
  })).status === 401,'Guest could import a private archive')

  const restoreBackup = await scopedMutation(restoreWorld,'/backup','POST',archive)
  const restoreReport = await restoreBackup.json()
  assert(restoreBackup.status === 200 && restoreReport.restored === 5 &&
    restoreReport.media === 1, 'Portable archive import failed: '+JSON.stringify(restoreReport))
  assert((await scopedMutation(restoreWorld,'/backup','POST',archive)).status === 409,
    'Cloud import overwrote populated workspace')
  const copiedSearch = await scoped(restoreWorld,'/search?q='+encodeURIComponent('迁移'))
  const copiedHits = (await copiedSearch.json()).hits
  const restoredId = title => copiedHits.find(hit => hit.title === title)?.entityId
  const targetCountryId = restoredId('迁移王国')
  const targetCharacterId = restoredId('迁移守护者')
  assert(targetCountryId && targetCharacterId && targetCountryId !== sourceCountry.id,
    'Imported entity IDs did not change across workspaces')
  const copiedCountryResponse = await fetch(BASE+'/api/entities/'+targetCountryId,{headers:{Cookie:cookie}})
  const copiedCharacterResponse = await fetch(BASE+'/api/entities/'+targetCharacterId,{headers:{Cookie:cookie}})
  const targetCountry = (await copiedCountryResponse.json()).entity
  const targetCharacter = (await copiedCharacterResponse.json()).entity
  assert(targetCharacter.content.countryId === targetCountry.local_id,
    'Cloud import broke original country reference')
  assert(targetCharacter.content.avatarUrl !== '/api/media/'+sourceAsset.id,
    'Backup reused the source workspace\'s private media ID')
  const copiedAsset = await fetch(BASE+targetCharacter.content.avatarUrl,{headers:{Cookie:cookie}})
  assert(copiedAsset.status === 200 &&
    (await copiedAsset.arrayBuffer()).byteLength === tinyPng.length,
    'Restored private image bytes are incomplete')
  const sourceSnapshot = archive.cloud.records.find(row => row.id === sourceCharacter.id)
  const restoredRevisions = await fetch(BASE+'/api/entities/'+targetCharacterId+'/revisions',
    {headers:{Cookie:cookie}})
  const restoredHistory = (await restoredRevisions.json()).revisions
  assert(restoredRevisions.status === 200 &&
    new Date(restoredHistory[0].created_at).getTime() ===
      new Date(sourceSnapshot.history[0].createdAt).getTime(),
    'Cross-VPS backup restore changed the original revision timestamp')
  const copiedConfigResponse = await scoped(restoreWorld,'/customization')
  assert((await copiedConfigResponse.json()).customization.categories.some(c=>c.name==='迁移文物'),
    'Custom categories were missing from restored archive')
  const copiedTrash = await scoped(restoreWorld,'/trash')
  const copiedDeleted = (await copiedTrash.json()).items
  const copiedBook = copiedDeleted.find(row=>row.title==='迁移史诗')
  assert(copiedBook?.version === 4,'Book deletion history was missing from archive')
  const restoreBook = await scopedMutation(restoreWorld,'/trash/'+copiedBook.id,
    'POST',{expectedVersion:copiedBook.version})
  assert(restoreBook.status === 200 && (await restoreBook.json()).items === 2,
    'Imported original book and chapter tree did not recover together')
  const copiedChapters = await scoped(restoreWorld,'/search?q='+encodeURIComponent('迁移第一章'))
  assert((await copiedChapters.json()).hits.some(hit=>hit.kind==='novel'),
    'Recovered imported chapter was not searchable')

  // The original desktop v1 .ocbak remains importable, including embedded
  // PNG bytes, numeric country references and legacy tag identifiers.
  const legacyWorld = await makeWorld('CI Legacy Desktop Import')
  const legacyArchive = {
    version:1,
    data:{
      characters:[{id:21,name:'旧版迁移角色',countryId:7,tags:[1],
        avatarUrl:'data:image/png;base64,'+tinyPng.toString('base64')}],
      countries:[{id:7,name:'旧版迁移国家'}],
      events:[],worldEntries:[],
      tags:[{id:1,name:'旧版分类标签',color:'#4ecdc4'}],
      periods:[{id:9,name:'旧时代年表'}],
      meta:[{id:1,worldName:'旧版世界'}],
    },
    config:{inspirations:[{id:'i-old',title:'旧版灵感',content:{type:'doc',content:[]}}]},
    journal:['{"ts":"2026-11-18T00:00:00Z","action":"create"}'],
  }
  const legacyResponse = await scopedMutation(legacyWorld,'/backup','POST',legacyArchive)
  const legacyResult=await legacyResponse.json()
  assert(legacyResponse.status===200 && legacyResult.source==='legacy' &&
    legacyResult.restored===2 && legacyResult.media===1 && legacyResult.tags===1,
    'Original desktop .ocbak import failed: '+JSON.stringify(legacyResult))
  const legacySearchResponse=await scoped(legacyWorld,'/search?q='+encodeURIComponent('旧版迁移'))
  const legacyHits=(await legacySearchResponse.json()).hits
  const countryHit=legacyHits.find(item=>item.title==='旧版迁移国家')
  const characterHit=legacyHits.find(item=>item.title==='旧版迁移角色')
  assert(countryHit&&characterHit,'Legacy imported entries were not indexed')
  const legacyCountryResponse=await fetch(BASE+'/api/entities/'+countryHit.entityId,
    {headers:{Cookie:cookie}})
  const legacyCharacterResponse=await fetch(BASE+'/api/entities/'+characterHit.entityId,
    {headers:{Cookie:cookie}})
  const legacyCountry=(await legacyCountryResponse.json()).entity
  const legacyCharacter=(await legacyCharacterResponse.json()).entity
  assert(legacyCharacter.content.countryId===legacyCountry.local_id,
    'Original desktop numeric country reference was not remapped')
  assert(Array.isArray(legacyCharacter.content.cloudTagIds) &&
    legacyCharacter.content.cloudTagIds.length===1,
    'Original numeric tags did not become shared cloud tags')
  const legacyMedia=await fetch(BASE+legacyCharacter.content.avatarUrl,{headers:{Cookie:cookie}})
  assert(legacyMedia.status===200 &&
    (await legacyMedia.arrayBuffer()).byteLength===tinyPng.byteLength,
    'Original desktop inline image was lost during conversion')
  const legacyRoundTrip=await scoped(legacyWorld,'/backup')
  assert(legacyRoundTrip.status===200,'Legacy backup could not be re-exported')
  const legacyReexport=await legacyRoundTrip.json()
  assert(legacyReexport.data.periods[0].name==='旧时代年表' &&
    legacyReexport.data.meta[0].worldName==='旧版世界' &&
    legacyReexport.config.inspirations[0].title==='旧版灵感' &&
    legacyReexport.journal.length===1 &&
    legacyReexport.cloud.settings.some(setting=>setting.key==='desktop-extras'),
    'Original desktop-only period/meta/inspiration/journal stores were lost in cloud migration')
  const badLegacy=await makeWorld('CI Invalid Archive')
  const invalidArchive={...legacyArchive,cloud:{format:'unrecognized-cloud-backup'}}
  const rejected=await scopedMutation(badLegacy,'/backup','POST',invalidArchive)
  assert(rejected.status===400,'An unsupported cloud sidecar was silently downgraded to legacy')
  const untouched=await scoped(badLegacy,'/search?q='+encodeURIComponent('旧版迁移'))
  assert((await untouched.json()).hits.length===0,
    'A rejected import left partial data in the new workspace')

  const workbenchPath = '/studio/' + workspaceId
  const workbench = await fetch(BASE + workbenchPath, { headers: { Cookie: cookie } })
  assert(workbench.status === 200, 'Private workbench did not open')
  const workbenchHtml = await workbench.text()
  assert(workbenchHtml.includes('CI Private World') && workbenchHtml.includes('工作台板块'),
    'Workbench is missing its workspace title or section navigation')
  const legacyWorkbench = await fetch(BASE + '/workspaces/' + workspaceId, {
    headers: { Cookie: cookie }, redirect: 'manual',
  })
  assert([302, 303, 307, 308].includes(legacyWorkbench.status) &&
    legacyWorkbench.headers.get('location') === workbenchPath, 'Legacy workbench address did not redirect')
  const guestWorkbench = await fetch(BASE + workbenchPath, { redirect: 'manual' })
  assert([302, 303, 307, 308].includes(guestWorkbench.status) &&
    guestWorkbench.headers.get('location') === '/login', 'Private workbench must redirect guests to login')

  const forbiddenOrigin = await fetch(BASE + '/api/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example', Cookie: cookie },
    body: JSON.stringify({ name: 'Malicious Write' }),
  })
  assert(forbiddenOrigin.status === 403, 'Cross-site write request must be rejected')

  process.stdout.write('OC Studio Cloud end-to-end login/workspace smoke passed.\n')
}

run().catch(error => { console.error(error); process.exitCode = 1 })

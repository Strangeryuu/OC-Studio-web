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

  const forbiddenOrigin = await fetch(BASE + '/api/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example', Cookie: cookie },
    body: JSON.stringify({ name: 'Malicious Write' }),
  })
  assert(forbiddenOrigin.status === 403, 'Cross-site write request must be rejected')

  process.stdout.write('OC Studio Cloud end-to-end login/workspace smoke passed.\n')
}

run().catch(error => { console.error(error); process.exitCode = 1 })

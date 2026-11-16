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
  assert(created.status === 201, 'Authenticated workspace creation failed HTTP ' + created.status + ': ' + await created.text())
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

  const forbiddenOrigin = await fetch(BASE + '/api/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example', Cookie: cookie },
    body: JSON.stringify({ name: 'Malicious Write' }),
  })
  assert(forbiddenOrigin.status === 403, 'Cross-site write request must be rejected')

  process.stdout.write('OC Studio Cloud end-to-end login/workspace smoke passed.\n')
}

run().catch(error => { console.error(error); process.exitCode = 1 })

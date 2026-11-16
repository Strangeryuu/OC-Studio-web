import 'server-only'
import { betterAuth } from 'better-auth'
import { admin } from 'better-auth/plugins'
import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/admin/access'
import { pool } from './db'

// Platform admin is for account maintenance only. User impersonation is
// deliberately omitted: it would bypass users' private-workspace membership.
// Workspace-specific permissions are checked in the cloud API.
const ac = createAccessControl(defaultStatements)
const siteAdmin = ac.newRole({
  user: ['create', 'list', 'ban', 'set-password', 'get', 'update'],
  session: ['list', 'revoke'],
})
const regularUser = ac.newRole({ user: [], session: [] })

// Configure DATABASE_URL, BETTER_AUTH_URL and BETTER_AUTH_SECRET before running.
export const auth = betterAuth({
  database: pool,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
  },
  plugins: [admin({
    defaultRole: 'user',
    ac,
    roles: { admin: siteAdmin, user: regularUser },
  })],
})

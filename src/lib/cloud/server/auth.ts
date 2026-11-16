import { betterAuth } from 'better-auth'
import { admin } from 'better-auth/plugins'
import { pool } from './db'
import { cloudAdminAccess, cloudRegularRole, cloudSiteAdminRole } from '../access-control'

export const auth = betterAuth({
  database: pool,
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
  plugins: [admin({
    defaultRole: 'user',
    ac: cloudAdminAccess,
    roles: { admin: cloudSiteAdminRole, user: cloudRegularRole },
  })],
})

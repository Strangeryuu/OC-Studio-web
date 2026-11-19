import { betterAuth } from 'better-auth'
import { admin } from 'better-auth/plugins'
import { pool } from './db'
import { sendPasswordResetMail } from './mailer'
import { cloudAdminAccess, cloudRegularRole, cloudSiteAdminRole } from '../access-control'

export const auth = betterAuth({
  database: pool,
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12,
    resetPasswordTokenExpiresIn: 3600,
    sendResetPassword: async ({ user, url }) => sendPasswordResetMail(user.email,url),
  },
  plugins: [admin({
    defaultRole: 'user',
    ac: cloudAdminAccess,
    roles: { admin: cloudSiteAdminRole, user: cloudRegularRole },
  })],
})

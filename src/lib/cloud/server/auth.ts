import 'server-only'
import { betterAuth } from 'better-auth'
import { admin } from 'better-auth/plugins'
import { pool } from './db'

// Site admin manages accounts; workspace-level permissions are checked separately.
// Configure DATABASE_URL, BETTER_AUTH_URL, BETTER_AUTH_SECRET before deployment.
export const auth = betterAuth({
  database: pool,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
  },
  plugins: [admin({ defaultRole: 'user', adminRoles: ['admin'] })],
})

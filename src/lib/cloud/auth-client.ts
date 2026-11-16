'use client'
import { createAuthClient } from 'better-auth/react'
import { adminClient } from 'better-auth/client/plugins'
import { cloudAdminAccess, cloudRegularRole, cloudSiteAdminRole } from './access-control'

export const authClient = createAuthClient({
  plugins: [adminClient({
    ac: cloudAdminAccess,
    roles: { admin: cloudSiteAdminRole, user: cloudRegularRole },
  })],
})

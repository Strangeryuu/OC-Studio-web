import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/admin/access'

// Keep the client-side Admin plugin types aligned with server-side rights.
export const cloudAdminAccess = createAccessControl(defaultStatements)
export const cloudSiteAdminRole = cloudAdminAccess.newRole({
  user: ['create', 'list', 'set-role', 'ban', 'set-password', 'get', 'update'],
  session: ['list', 'revoke'],
})
export const cloudRegularRole = cloudAdminAccess.newRole({ user: [], session: [] })

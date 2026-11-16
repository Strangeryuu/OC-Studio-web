/**
 * Cloud workspace authorization policy.
 *
 * IMPORTANT: role and account status must come from the trusted server-side DB
 * after session authentication, never from the request body or a JWT role claim.
 * This pure policy module has no DB/runtime dependency and can be reused by
 * HTTP routes and the WebSocket collaboration gateway.
 */
export const WORKSPACE_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export const WORKSPACE_ACTIONS = [
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'member:invite',
  'member:manage',
  'entity:read',
  'entity:create',
  'entity:update',
  'entity:delete',
  'entity:restore',
  'revision:read',
  'comment:create',
  'media:read',
  'media:upload',
  'export:create',
] as const
export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[number]
export type AccountStatus = 'active' | 'disabled' | 'pending'

export interface WorkspacePrincipal {
  /** Persisted account status, checked against the database. */
  accountStatus: AccountStatus
  /** Persisted role of this user within the requested workspace. */
  role: WorkspaceRole | null
}

const OWNER_ACTIONS: ReadonlySet<WorkspaceAction> = new Set(WORKSPACE_ACTIONS)
const ADMIN_ACTIONS: ReadonlySet<WorkspaceAction> = new Set(
  WORKSPACE_ACTIONS.filter((action) => action !== 'workspace:delete'),
)
const EDITOR_ACTIONS: ReadonlySet<WorkspaceAction> = new Set([
  'workspace:read',
  'entity:read',
  'entity:create',
  'entity:update',
  'revision:read',
  'comment:create',
  'media:read',
  'media:upload',
  'export:create',
])
const VIEWER_ACTIONS: ReadonlySet<WorkspaceAction> = new Set([
  'workspace:read',
  'entity:read',
  'revision:read',
  'comment:create',
  'media:read',
])

const ACTIONS_BY_ROLE: Readonly<Record<WorkspaceRole, ReadonlySet<WorkspaceAction>>> = {
  owner: OWNER_ACTIONS,
  admin: ADMIN_ACTIONS,
  editor: EDITOR_ACTIONS,
  viewer: VIEWER_ACTIONS,
}

export function canPerformWorkspaceAction(
  principal: WorkspacePrincipal | null,
  action: WorkspaceAction,
): boolean {
  if (principal === null || principal.accountStatus !== 'active' || principal.role === null) {
    return false
  }
  return ACTIONS_BY_ROLE[principal.role]?.has(action) ?? false
}

export class WorkspacePermissionError extends Error {
  readonly status = 403
  readonly code = 'WORKSPACE_FORBIDDEN'

  constructor() {
    super('没有访问该世界观或执行该操作的权限')
    this.name = 'WorkspacePermissionError'
  }
}

export function requireWorkspaceAction(
  principal: WorkspacePrincipal | null,
  action: WorkspaceAction,
): void {
  if (!canPerformWorkspaceAction(principal, action)) {
    throw new WorkspacePermissionError()
  }
}

/** Only owners can transfer ownership or permanently delete a workspace. */
export function canManageOwnership(principal: WorkspacePrincipal | null): boolean {
  return principal?.accountStatus === 'active' && principal.role === 'owner'
}

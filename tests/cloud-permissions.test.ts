import { describe, expect, it } from 'vitest'
import {
  canManageOwnership,
  canPerformWorkspaceAction,
  requireWorkspaceAction,
  WorkspacePermissionError,
  type WorkspaceRole,
} from '@/lib/cloud/permissions'

const asRole = (role: WorkspaceRole) => ({ accountStatus: 'active' as const, role })

describe('cloud workspace authorization policy', () => {
  it('denies guests, disabled accounts and non-members', () => {
    expect(canPerformWorkspaceAction(null, 'entity:read')).toBe(false)
    expect(canPerformWorkspaceAction({ accountStatus: 'active', role: null }, 'entity:read')).toBe(false)
    expect(canPerformWorkspaceAction({ accountStatus: 'disabled', role: 'owner' }, 'entity:read')).toBe(false)
    expect(canPerformWorkspaceAction({ accountStatus: 'pending', role: 'owner' }, 'entity:read')).toBe(false)
  })

  it('allows only the owner to delete the workspace or transfer ownership', () => {
    expect(canPerformWorkspaceAction(asRole('owner'), 'workspace:delete')).toBe(true)
    expect(canManageOwnership(asRole('owner'))).toBe(true)
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      expect(canPerformWorkspaceAction(asRole(role), 'workspace:delete')).toBe(false)
      expect(canManageOwnership(asRole(role))).toBe(false)
    }
  })

  it('permits admin management while keeping ownership exclusive', () => {
    expect(canPerformWorkspaceAction(asRole('admin'), 'member:invite')).toBe(true)
    expect(canPerformWorkspaceAction(asRole('admin'), 'entity:restore')).toBe(true)
    expect(canPerformWorkspaceAction(asRole('admin'), 'workspace:delete')).toBe(false)
  })

  it('allows editors to change content but not manage members or restore revisions', () => {
    expect(canPerformWorkspaceAction(asRole('editor'), 'entity:update')).toBe(true)
    expect(canPerformWorkspaceAction(asRole('editor'), 'media:upload')).toBe(true)
    expect(canPerformWorkspaceAction(asRole('editor'), 'member:invite')).toBe(false)
    expect(canPerformWorkspaceAction(asRole('editor'), 'entity:delete')).toBe(false)
    expect(canPerformWorkspaceAction(asRole('editor'), 'entity:restore')).toBe(false)
  })

  it('allows viewer reads and comments, denies writes', () => {
    expect(canPerformWorkspaceAction(asRole('viewer'), 'revision:read')).toBe(true)
    expect(canPerformWorkspaceAction(asRole('viewer'), 'comment:create')).toBe(true)
    expect(canPerformWorkspaceAction(asRole('viewer'), 'media:read')).toBe(true)
    expect(canPerformWorkspaceAction(asRole('viewer'), 'entity:update')).toBe(false)
    expect(() => requireWorkspaceAction(asRole('viewer'), 'entity:update')).toThrow(WorkspacePermissionError)
  })
})

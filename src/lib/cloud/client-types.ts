import type { WorkspaceRole } from './permissions'

export interface CloudEntityRow {
  id: string
  workspace_id: string
  kind: string
  title: string
  content: Record<string, unknown>
  version: number
  updated_at: string
}

export interface CloudEntityListItem {
  id: string
  kind: string
  title: string
  version: number
  updated_at: string
}

export interface CloudRevision {
  version: number
  action: 'create' | 'update' | 'restore' | 'delete'
  summary: string | null
  actor_id: string
  actor_name: string
  created_at: string
}

export type EditableWorkspaceRole = WorkspaceRole

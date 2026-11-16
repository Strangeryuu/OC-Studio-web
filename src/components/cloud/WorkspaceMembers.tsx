'use client'

import { useState } from 'react'
import { Trash2, Users } from 'lucide-react'
import type { WorkspaceRole } from '@/lib/cloud/permissions'

export interface MemberRow {
  user_id: string
  name: string
  email: string
  role: WorkspaceRole
}

export function WorkspaceMembers({ workspaceId, selfId, role, initialMembers }: {
  workspaceId: string; selfId: string; role: WorkspaceRole; initialMembers: MemberRow[]
}) {
  const [members, setMembers] = useState(initialMembers)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canManage = role === 'owner' || role === 'admin'

  async function changeRole(member: MemberRow, nextRole: 'admin' | 'editor' | 'viewer') {
    if (!canManage || busyId) return
    setBusyId(member.user_id)
    setError(null)
    try {
      const response = await fetch('/api/workspaces/' + workspaceId + '/members/' + encodeURIComponent(member.user_id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      })
      if (!response.ok) throw new Error('更新权限失败（HTTP ' + response.status + '）')
      setMembers(current => current.map(row => row.user_id === member.user_id ? { ...row, role: nextRole } : row))
      if (member.user_id === selfId) window.location.reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '更新失败') }
    finally { setBusyId(null) }
  }

  async function removeMember(member: MemberRow) {
    if (!canManage || busyId || !window.confirm('确定移除此成员的项目访问权限？')) return
    setBusyId(member.user_id)
    setError(null)
    try {
      const response = await fetch('/api/workspaces/' + workspaceId + '/members/' + encodeURIComponent(member.user_id), {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('移除失败（HTTP ' + response.status + '）')
      setMembers(current => current.filter(row => row.user_id !== member.user_id))
      if (member.user_id === selfId) window.location.assign('/')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '移除失败') }
    finally { setBusyId(null) }
  }

  return <section className="rounded-lg border border-[var(--oc-line)] p-5">
    <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Users size={18}/>项目成员</h2>
    {error && <p role="alert" className="mb-3 text-sm">{error}</p>}
    <ul className="flex flex-col gap-2">
      {members.map(member => <li key={member.user_id}
        className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--oc-line)] py-3 text-sm">
        <div>
          <p className="font-medium">{member.name}{member.user_id === selfId ? '（我）' : ''}</p>
          <p className="text-xs opacity-60">{member.email}</p>
        </div>
        {canManage && member.role !== 'owner'
          ? <div className="flex gap-2">
              <label className="sr-only" htmlFor={'role-' + member.user_id}>成员角色</label>
              <select id={'role-' + member.user_id} value={member.role}
                disabled={busyId !== null}
                onChange={event => void changeRole(member, event.target.value as 'admin' | 'editor' | 'viewer')}
                className="rounded-md border border-[var(--oc-line)] bg-[var(--oc-paper)] px-2 py-1 text-sm">
                <option value="admin">管理员</option>
                <option value="editor">编辑者</option>
                <option value="viewer">访客</option>
              </select>
              <button type="button" aria-label={'移除 ' + member.name}
                onClick={() => void removeMember(member)} disabled={busyId !== null}
                className="rounded-md border border-[var(--oc-line)] px-2 py-1 disabled:opacity-50">
                <Trash2 size={15}/>
              </button>
            </div>
          : <span className="text-xs opacity-60">{member.role}</span>}
      </li>)}
    </ul>
  </section>
}

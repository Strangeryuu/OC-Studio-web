import { notFound, redirect } from 'next/navigation'
import { currentCloudUser } from '@/lib/cloud/server/authorization'
import { pool } from '@/lib/cloud/server/db'
import { AdminUsers, type AdminUserRow } from '@/components/cloud/AdminUsers'

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  const actor = await currentCloudUser()
  if (!actor) redirect('/login')
  const result = await pool.query<{ role: string | null }>(
    'SELECT role FROM "user" WHERE id=$1', [actor.id],
  )
  if (!result.rows[0]?.role?.split(',').includes('admin')) notFound()
  const users = await pool.query<AdminUserRow>(
    'SELECT id,name,email,role,banned FROM "user" WHERE deleted_at IS NULL ORDER BY email LIMIT 100',
  )
  return <AdminUsers initialUsers={users.rows} selfId={actor.id}/>
}

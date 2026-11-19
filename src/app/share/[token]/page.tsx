import { notFound } from 'next/navigation'
import { pool } from '@/lib/cloud/server/db'
import { sharedWorkspace, shareTokenDigest } from '@/lib/cloud/server/public-share'
import { PublicWorkspaceViewer, type SharedEntry } from '@/components/cloud/PublicWorkspaceViewer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

type Props = {
  params: Promise<{ token: string }>
  searchParams: Promise<{ section?: string; entry?: string; category?: string; q?: string }>
}

export default async function PublicSharePage({ params, searchParams }: Props) {
  const { token } = await params
  const workspace = await sharedWorkspace(token)
  if (!workspace) notFound()
  // Every page navigation reads live data and rechecks share revocation.
  // Avoid routing guests through any authenticated workspace API.
  const [entries, settings] = await Promise.all([
    pool.query<SharedEntry>(`SELECT e.id,e.local_id::text,e.kind,e.title,e.content,e.updated_at::text
      FROM entities e JOIN workspace_public_shares s ON s.workspace_id=e.workspace_id
      JOIN workspaces w ON w.id=s.workspace_id
      WHERE s.token_sha256=$1 AND s.revoked_at IS NULL AND w.deleted_at IS NULL
        AND e.deleted_at IS NULL
      ORDER BY e.local_id ASC`, [shareTokenDigest(token)]),
    pool.query<{ setting_key: string; setting_value: unknown }>(
      `SELECT setting_key,setting_value FROM workspace_settings
       WHERE workspace_id=$1 AND setting_key IN ('world-cover','customization')`,
      [workspace.id]),
  ])
  const config = new Map(settings.rows.map(item => [item.setting_key, item.setting_value]))
  const value = config.get('world-cover')
  const cover = typeof value === 'string' ? value : ''
  const customization = config.get('customization')
  const categories: string[] = []
  if (customization && typeof customization === 'object' && !Array.isArray(customization) &&
    'categories' in customization && Array.isArray(customization.categories)) {
    for (const category of customization.categories) {
      if (category && typeof category === 'object' && 'name' in category &&
        typeof category.name === 'string' && category.enabled === true) {
        categories.push(category.name)
      }
    }
  }
  return <PublicWorkspaceViewer token={token} workspace={workspace} entries={entries.rows}
    cover={cover} categories={categories} selection={await searchParams} />
}

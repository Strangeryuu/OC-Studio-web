import { notFound, redirect } from 'next/navigation'
import { currentCloudUser, authorizedWorkspace } from '@/lib/cloud/server/authorization'
import { loadCloudCharacterConfig } from '@/lib/cloud/server/character-config'
import { CloudCharacterSettings } from '@/components/cloud/CloudCharacterSettings'

export const dynamic = 'force-dynamic'

export default async function CharacterSettingsPage({ params }: {
  params: Promise<{ workspaceId: string }>
}) {
  const user = await currentCloudUser()
  if (!user) redirect('/login')
  const { workspaceId } = await params
  const role = await authorizedWorkspace(user, workspaceId, 'workspace:read')
  if (!role) notFound()
  const { config, version } = await loadCloudCharacterConfig(workspaceId)
  return <CloudCharacterSettings
    workspaceId={workspaceId}
    editable={role === 'owner' || role === 'admin'}
    initialConfig={config}
    initialVersion={version}
  />
}

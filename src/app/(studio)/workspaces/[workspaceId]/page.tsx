import { notFound, redirect } from 'next/navigation'
import { isUuid } from '@/lib/cloud/server/authorization'

/** Existing workspace links keep working after the workbench route moves. */
export default async function WorkspaceRedirect({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  if (!isUuid(workspaceId)) notFound()
  redirect(`/studio/${workspaceId}`)
}

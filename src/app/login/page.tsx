import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/cloud/server/auth'
import { LoginForm } from '@/components/cloud/LoginForm'
import { setupNeeded } from '@/lib/cloud/server/site-admin'

// Onboarding checks live database state and must never prerender at build time.
export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const requestHeaders=await headers()
  if(await setupNeeded())redirect('/setup')
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (session && !session.user.banned) redirect('/')
  return <main className="flex min-h-screen items-center justify-center p-6"><LoginForm /></main>
}

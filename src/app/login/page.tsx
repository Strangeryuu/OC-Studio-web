import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/cloud/server/auth'
import { LoginForm } from '@/components/cloud/LoginForm'

export default async function LoginPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (session && !session.user.banned) redirect('/')
  return <main className="flex min-h-screen items-center justify-center p-6"><LoginForm /></main>
}

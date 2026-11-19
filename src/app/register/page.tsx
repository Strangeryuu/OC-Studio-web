import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { setupNeeded } from '@/lib/cloud/server/site-admin'
import { RegistrationForm } from '@/components/cloud/RegistrationForm'
export const dynamic='force-dynamic'
export default async function Page(){
  await headers()
  if(await setupNeeded())redirect('/setup')
  return <main className="flex min-h-screen items-center justify-center p-6"><RegistrationForm/></main>
}

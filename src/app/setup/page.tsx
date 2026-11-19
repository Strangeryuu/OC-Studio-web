import { redirect } from 'next/navigation'
import { setupNeeded } from '@/lib/cloud/server/site-admin'
import { SetupAdminForm } from '@/components/cloud/SetupAdminForm'
export const dynamic='force-dynamic'
export default async function SetupPage(){
  if(!await setupNeeded())redirect('/login')
  return <main className="mx-auto flex min-h-screen max-w-md items-center p-5">
    <SetupAdminForm /></main>
}

import {notFound} from 'next/navigation'
import {siteAdminUser} from '@/lib/cloud/server/site-admin'
import {AdminBackups} from '@/components/cloud/AdminBackups'
export const dynamic='force-dynamic'
export default async function Page(){
  if(!await siteAdminUser())notFound()
  return <AdminBackups/>
}

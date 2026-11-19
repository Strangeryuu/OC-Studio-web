import { notFound } from 'next/navigation'
import { siteAdminUser } from '@/lib/cloud/server/site-admin'
import { MailSettingsForm } from '@/components/cloud/MailSettingsForm'
export const dynamic='force-dynamic'
export default async function Page(){
 if(!await siteAdminUser())notFound()
 return <MailSettingsForm/>
}

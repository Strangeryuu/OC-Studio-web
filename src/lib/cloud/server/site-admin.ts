import 'server-only'
import { pool } from './db'
import { currentCloudUser } from './authorization'
import { isSiteAdmin } from '@/lib/cloud/site-policy'

export async function siteAdminUser() {
  const user=await currentCloudUser()
  return user&&isSiteAdmin(user.role)?user:null
}
export async function setupNeeded():Promise<boolean>{
  const [users,settings]=await Promise.all([
    pool.query('SELECT 1 FROM "user" LIMIT 1'),
    pool.query("SELECT 1 FROM site_settings WHERE key='initialized' LIMIT 1"),
  ])
  return users.rowCount===0&&settings.rowCount===0
}

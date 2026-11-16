import 'server-only'
import { pool } from './db'
import {
  defaultCloudCharacterConfig, parseCloudCharacterConfig,
  type CloudCharacterConfig,
} from '@/lib/cloud/character-config'

export async function loadCloudCharacterConfig(workspaceId: string): Promise<{
  config: CloudCharacterConfig
  version: number
}> {
  const result = await pool.query<{ setting_value: unknown; version: number }>(
    "SELECT setting_value, version FROM workspace_settings WHERE workspace_id=$1 AND setting_key='character-config'",
    [workspaceId],
  )
  if (!result.rows[0]) return { config: defaultCloudCharacterConfig(), version: 0 }
  const config = parseCloudCharacterConfig(result.rows[0].setting_value)
  if (!config) throw new Error('Cloud character configuration stored in database is invalid')
  return { config, version: result.rows[0].version }
}

'use client'

import type { VaultTableName } from '@/lib/vault/vault-session'

/** 与旧版模板保持类型兼容，网页版不显示历史操作入口。 */
export function EntityHistoryButton(_props: { table: VaultTableName; id: number; name?: string }) {
  return null
}

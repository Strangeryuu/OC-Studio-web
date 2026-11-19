import { NextResponse } from 'next/server'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** 历史版本回滚接口停用；回收站恢复走 /api/workspaces/[workspaceId]/trash。 */
export async function POST(_request: Request, _context: { params: Promise<{ entityId: string }> }) {
  return NextResponse.json({ error: 'HISTORY_DISABLED' }, { status: 410 })
}

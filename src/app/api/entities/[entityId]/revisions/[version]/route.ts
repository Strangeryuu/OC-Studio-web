import { NextResponse } from 'next/server'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** 逐版本历史访问已关闭。回收站中的词条仍可从当前内容恢复。 */
export async function GET() {
  return NextResponse.json({ error: 'HISTORY_DISABLED' }, { status: 410 })
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Period } from '@/types'
import type { PeriodFields } from '@/lib/cloud/periods'

interface PeriodResponse { periods: Period[]; version: number; error?: string }
export function useCloudPeriods(workspaceId?: string, canEdit = false) {
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const version = useRef(0)
  const writing = useRef(false)
  const url = workspaceId ? '/api/workspaces/' + encodeURIComponent(workspaceId) + '/periods' : null

  const refresh = useCallback(async () => {
    if (!url) return
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error('加载世界观时期失败')
    const result = await response.json() as PeriodResponse
    version.current = result.version
    setPeriods(result.periods)
    setError(null)
  }, [url])

  useEffect(() => {
    if (!url) return
    let active = true
    setLoading(true)
    fetch(url, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('加载世界观时期失败')
        return response.json() as Promise<PeriodResponse>
      })
      .then(result => {
        if (!active) return
        version.current = result.version
        setPeriods(result.periods)
        setLoading(false)
        setError(null)
      })
      .catch(cause => {
        if (!active) return
        setError(cause instanceof Error ? cause.message : '加载世界观时期失败')
        setLoading(false)
      })
    return () => { active = false }
  }, [url])

  const mutate = useCallback(async (operation: 'create' | 'update' | 'delete',
    id?: number, period?: PeriodFields) => {
    if (!canEdit || !url) throw new Error('当前账号无权修改时期')
    if (writing.current) throw new Error('上一项时期更改正在保存')
    writing.current = true
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, id, period, expectedVersion: version.current }),
      })
      const result = await response.json() as PeriodResponse
      if (!response.ok) {
        if (response.status === 409 && result.error === 'VERSION_CONFLICT') {
          try { await refresh() }
          catch { setError('时期冲突后的同步失败，请刷新页面') }
          throw new Error('另一台设备已修改时期，列表已经刷新，请重新提交')
        }
        throw new Error(response.status === 404
          ? '时期已删除或世界观访问权限发生变化'
          : '时期保存失败，请检查网络及权限后重试')
      }
      version.current = result.version
      setPeriods(result.periods)
      setError(null)
    } finally {
      writing.current = false
    }
  }, [canEdit, url, refresh])

  return {
    periods, loading, error, refresh,
    addPeriod: (fields: PeriodFields) => mutate('create', undefined, fields),
    updatePeriod: (id: number, fields: Partial<PeriodFields>) =>
      mutate('update', id, fields as PeriodFields),
    removePeriod: (id: number) => mutate('delete', id),
  }
}

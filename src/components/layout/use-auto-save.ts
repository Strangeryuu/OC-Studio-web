'use client'

import { useEffect, useRef } from 'react'

import type { SaveOutcome } from '@/lib/save-outcome'

/**
 * 静置自动保存。
 *
 * 为什么不是「卸载时保存」：分区是**常驻挂载**的（`data-visible` + `display:none`），
 * 返回列表 / 切分区都不会卸载编辑器，卸载钩子根本不触发 —— 那条路验证过，改动照样丢。
 *
 * 第一次进入未保存状态后等待五分钟进行一次周期性保存；持续输入不会重置计时。
 * 切换词条、返回列表、离开工作区仍由 pending-save 屏障即时保存草稿。
 *
 * 成功回执只确认**提交的那一版**：如果五分钟保存期间用户又输入了，
 * `dirty` 仍然是 true，`saving` 落回 false 后这里会再排一轮（继续保存新修订）。
 *
 * 失败处理：保存抛错 / 返回 failed 后**停下来**，等用户手动点保存再试 ——
 * 以免「保存失败 → 仍是脏 → 反复重试」形成连续错误提示。
 */
export function useAutoSave({
  dirty,
  saving,
  save,
  delay = 5 * 60 * 1000,
}: {
  dirty: boolean
  saving: boolean
  save: () => Promise<SaveOutcome>
  delay?: number
}): void {
  const failedRef = useRef(false)
  const saveRef = useRef(save)
  saveRef.current = save

  // 重新变干净（保存成功 / 撤销回原样）= 失败状态解除
  useEffect(() => {
    if (!dirty) failedRef.current = false
  }, [dirty])

  useEffect(() => {
    if (!dirty || saving || failedRef.current) return
    const timer = setTimeout(() => {
      void saveRef.current()
        .then((outcome) => {
          if (outcome.status === 'failed') failedRef.current = true
        })
        .catch(() => {
          // 保存函数约定不抛；真抛了也按失败处理，不无限重试
          failedRef.current = true
        })
    }, delay)
    return () => clearTimeout(timer)
  }, [dirty, saving, delay])
}

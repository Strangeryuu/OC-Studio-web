import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WorkspaceDeleteAction } from '@/components/cloud/WorkspaceDeleteAction'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let host: HTMLDivElement
const action = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')]
  .find(button => button.getAttribute('aria-label') === name || button.textContent?.trim() === name)

async function click(button: HTMLButtonElement | undefined) {
  expect(button, 'Expected button to exist').toBeDefined()
  await act(async () => { button!.click(); await Promise.resolve() })
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('cloud delete confirmation shared by entity and category lists', () => {
  it('requires an explicit confirmation and supports cancellation', async () => {
    const onConfirm = vi.fn(async () => undefined)
    await act(async () => root.render(React.createElement(WorkspaceDeleteAction, {
      label: '角色「演示」', description: '移入回收站', onConfirm,
    })))
    expect(onConfirm).not.toHaveBeenCalled()
    await click(action('删除角色「演示」'))
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('移入回收站')
    expect(onConfirm).not.toHaveBeenCalled()
    await click(action('取消'))
    expect(onConfirm).not.toHaveBeenCalled()
    await click(action('删除角色「演示」'))
    await click(action('确认删除'))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('retains the confirmation dialog after a failed request', async () => {
    const onConfirm = vi.fn(async () => { throw new Error('版本冲突') })
    await act(async () => root.render(React.createElement(WorkspaceDeleteAction, {
      label: '分类「新分类」', description: '词条会保留', onConfirm,
    })))
    await click(action('删除分类「新分类」'))
    await click(action('确认删除'))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('版本冲突')
  })

  it('disables deletion for restricted roles or concurrent writes', async () => {
    const onConfirm = vi.fn(async () => undefined)
    await act(async () => root.render(React.createElement(WorkspaceDeleteAction, {
      label: '事件「只读」', description: '移入回收站', disabled: true, onConfirm,
    })))
    const trigger = action('删除事件「只读」')
    expect(trigger?.disabled).toBe(true)
    await click(trigger)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  })
})

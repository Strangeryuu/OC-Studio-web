import { afterEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const fake = vi.hoisted(() => ({ signOut: vi.fn(), flush: vi.fn() }))
vi.mock('@/lib/cloud/auth-client', () => ({ authClient: { signOut: fake.signOut } }))
vi.mock('@/lib/pending-saves', () => ({ flushPendingSaves: fake.flush }))
import { SignOutButton } from '@/components/cloud/SignOutButton'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.clearAllMocks() })

describe('sign out with unsaved work', () => {
  it('leaves the user signed in and shows the failure when saving fails', async () => {
    fake.flush.mockRejectedValue(new Error('版本冲突'))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => { root.render(React.createElement(SignOutButton)) })
    await act(async () => { container.querySelector('button')!.click(); await Promise.resolve(); await Promise.resolve() })
    expect(fake.signOut).not.toHaveBeenCalled()
    expect(container.textContent).toContain('版本冲突')
    expect(document.body.inert).toBe(false)
    await act(async () => { root.unmount() })
    container.remove()
  })

  it('waits for the save barrier before requesting sign out', async () => {
    let finish!: () => void
    fake.flush.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    fake.signOut.mockResolvedValue({ error: { message: 'failure' } })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => { root.render(React.createElement(SignOutButton)) })
    await act(async () => { container.querySelector('button')!.click(); await Promise.resolve() })
    expect(fake.signOut).not.toHaveBeenCalled()
    expect(document.body.inert).toBe(true)
    await act(async () => { finish(); await Promise.resolve(); await Promise.resolve() })
    expect(fake.signOut).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('退出登录失败')
    expect(document.body.inert).toBe(false)
    await act(async () => { root.unmount() })
    container.remove()
  })
})

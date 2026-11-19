import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WorkspaceEntityCatalog } from '@/components/cloud/WorkspaceEntityCatalog'
import { buildDefaultCharacter } from '@/features/characters/services'
import { newCharacterData } from '@/lib/entity-defaults'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const workspaceId = '11111111-1111-4111-8111-111111111111'
let mount: HTMLDivElement
let root: Root
let overlay: HTMLDivElement
let fetchMock: ReturnType<typeof vi.fn>

function makeRow(id: number, name: string) {
  return {
    entityId: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    version: 1,
    data: { ...buildDefaultCharacter({ ...newCharacterData(), name }), id },
  }
}
const rows = [makeRow(1, '黎明'), makeRow(2, '夜空')]
function findButton(label: string) {
  const result = [...mount.querySelectorAll('button')].find(button => button.textContent?.trim() === label)
  if (!result) throw new Error('button missing: ' + label)
  return result as HTMLButtonElement
}
async function press(button: HTMLButtonElement) {
  await act(async () => { button.click(); await Promise.resolve() })
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

beforeEach(() => {
  localStorage.clear()
  mount = document.createElement('div')
  overlay = document.createElement('div')
  overlay.id = 'overlay-root'
  document.body.append(mount, overlay)
  root = createRoot(mount)
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(
    init?.method === 'POST'
      ? { folders: ['主角组'], folderVersion: 1, versions: {} }
      : { folders: [], version: 0 },
  ), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  mount.remove()
  overlay.remove()
  vi.unstubAllGlobals()
})

describe('original-style cloud catalog', () => {
  it('shows card, gallery, list controls, search and original sort options', async () => {
    await act(async () => { root.render(React.createElement(WorkspaceEntityCatalog, {
      workspaceId, kind: 'character', rows, loading: false, error: null, busy: false,
      selectedId: null, onSelect: vi.fn(), onUpdated: async () => {},
      onCreate: vi.fn(),
    })) })
    expect(findButton('黎明')).toBeTruthy()
    expect(mount.querySelector('button[aria-label="卡片视图"]')).toBeTruthy()
    expect(mount.querySelector('button[aria-label="画廊视图"]')).toBeTruthy()
    expect(mount.querySelector('button[aria-label="列表视图"]')).toBeTruthy()
    await press(mount.querySelector('button[aria-label="列表视图"]')!)
    expect(mount.textContent).toContain('夜空')
    await type(mount.querySelector('input[aria-label="搜索角色"]')!, '黎明')
    expect(mount.textContent).toContain('黎明')
    expect(mount.textContent).not.toContain('夜空')
    expect(mount.textContent).toContain('1 / 2')
    await type(mount.querySelector('input[aria-label="搜索角色"]')!, '')
    await press(mount.querySelector('button[aria-label="画廊视图"]')!)
    expect(mount.textContent).toContain('夜空')
    expect(localStorage.getItem('oc-cloud-' + workspaceId + '-character-view')).toBe('gallery')
  })

  it('keeps folder registry in cloud workspace and supports creation', async () => {
    await act(async () => { root.render(React.createElement(WorkspaceEntityCatalog, {
      workspaceId, kind: 'character', rows, loading: false, error: null, busy: false,
      selectedId: null, onSelect: vi.fn(), onUpdated: async () => {},
      onCreate: vi.fn(),
    })) })
    const field = mount.querySelector<HTMLInputElement>('input[aria-label="新建文件夹"]')!
    expect(field).toBeTruthy()
    await type(field, '主角组')
    await press([...mount.querySelectorAll<HTMLButtonElement>('button[aria-label="新建文件夹"]')][0])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/' + workspaceId + '/catalog',
      expect.objectContaining({ method: 'POST' }),
    )
    const post = fetchMock.mock.calls.find((call: unknown[]) => (call[1] as RequestInit | undefined)?.method === 'POST')!
    expect(JSON.parse((post[1] as RequestInit).body as string)).toMatchObject({
      action: 'folders', folders: ['主角组'], updates: [],
    })
    expect(mount.textContent).toContain('主角组')
  })

  it('hides folder mutations for a viewer but retains filters', async () => {
    await act(async () => { root.render(React.createElement(WorkspaceEntityCatalog, {
      workspaceId, kind: 'character', rows, loading: false, error: null, busy: false,
      selectedId: null, onSelect: vi.fn(), onUpdated: async () => {},
    })) })
    expect(mount.textContent).toContain('未分组')
    expect(mount.querySelector('input[aria-label="新建文件夹"]')).toBeNull()
    expect(mount.querySelector('button[aria-label="删除文件夹"]')).toBeNull()
  })
})

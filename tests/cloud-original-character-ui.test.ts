import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { OriginalCharacterSnapshot } from '@/lib/cloud/adapters/original-characters'
import { buildDefaultCharacter } from '@/features/characters/services'
import { newCharacterData } from '@/lib/entity-defaults'
import * as characters from '@/features/characters/services'
import * as countries from '@/features/countries/services'
import * as world from '@/features/world/services'

const fake = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/cloud/adapters/original-characters', () => ({
  OriginalCharactersCloudAdapter: class {
    list = fake.list
    save = fake.save
    create = fake.create
  },
}))
vi.mock('@/components/shared/toaster', () => ({ Toaster: () => null }))

import { WorkspaceCharacters, editablePatch } from '@/features/characters/cloud/WorkspaceCharacters'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const workspaceId = '11111111-1111-4111-8111-111111111111'
let root: Root
let container: HTMLDivElement

function fixture(id: number, name: string): OriginalCharacterSnapshot {
  return {
    workspaceId, entityId: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, version: 1,
    character: { ...buildDefaultCharacter({ ...newCharacterData(), name }), id },
  }
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(element => element.textContent?.trim() === label)
  if (!found) throw new Error(`Button not found: ${label}`)
  return found
}

async function click(element: HTMLElement) {
  await act(async () => { element.click(); await Promise.resolve(); await Promise.resolve() })
}

async function inputText(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('original character information in cloud workspace', () => {
  it('reuses the original form, saves only edited fields, and does not query the browser library', async () => {
    const first = fixture(1, '初始角色')
    first.character.birthday = 'invalid-date'
    first.character.gallery = [{ url: '/old-image', caption: '保留说明' }]
    const characterRead = vi.spyOn(characters, 'getCharacters')
    const countryRead = vi.spyOn(countries, 'getCountries')
    const noteRead = vi.spyOn(world, 'getAllEntries')
    fake.list.mockResolvedValue([first])
    fake.save.mockImplementation(async (snapshot: OriginalCharacterSnapshot, patch: Record<string, unknown>) => ({
      ...snapshot, version: snapshot.version + 1, character: { ...snapshot.character, ...patch },
    }))
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'editor' })); await Promise.resolve() })
    await click(button('初始角色'))
    const name = container.querySelector('input') as HTMLInputElement
    expect(name.value).toBe('初始角色')
    await inputText(name, '修改角色')
    await click(button('初始角色'))
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('修改角色')
    expect(fake.save).not.toHaveBeenCalled()
    await click(button('保存'))
    expect(fake.save).toHaveBeenCalledOnce()
    expect(fake.save.mock.calls[0][1]).toEqual({ name: '修改角色' })
    expect(characterRead).not.toHaveBeenCalled()
    expect(countryRead).not.toHaveBeenCalled()
    expect(noteRead).not.toHaveBeenCalled()
  })

  it('keeps the draft and stays on the current character after a conflict', async () => {
    const first = fixture(1, '甲')
    fake.list.mockResolvedValue([first, fixture(2, '乙')])
    fake.save.mockRejectedValue(new Error('版本冲突'))
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'editor' })); await Promise.resolve() })
    await click(button('甲'))
    const name = container.querySelector('input') as HTMLInputElement
    await inputText(name, '未保存草稿')
    await click(button('保存'))
    expect(container.textContent).toContain('版本冲突')
    expect((container.querySelector('textarea[aria-label="当前草稿"]') as HTMLTextAreaElement).value).toContain('未保存草稿')
    await click(button('乙'))
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('未保存草稿')
  })

  it('renders viewer fields disabled and omits create and save', async () => {
    fake.list.mockResolvedValue([fixture(1, '只读角色')])
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'viewer' })); await Promise.resolve() })
    await click(button('只读角色'))
    expect(container.querySelector('fieldset')?.disabled).toBe(true)
    expect([...container.querySelectorAll('button')].map(item => item.textContent)).not.toContain('保存')
    expect([...container.querySelectorAll('button')].map(item => item.textContent)).not.toContain('新建角色')
  })

  it('shows the server revision history to a viewer', async () => {
    fake.list.mockResolvedValue([fixture(1, '只读角色')])
    const fetchHistory = vi.fn().mockResolvedValue(new Response(JSON.stringify({ revisions: [
      { version: 2, actor_name: '创作者', action: 'update', created_at: '2026-01-01T00:00:00Z' },
    ] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchHistory)
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'viewer' })); await Promise.resolve() })
    await click(button('只读角色'))
    const details = container.querySelector('details')!
    await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')); await Promise.resolve(); await Promise.resolve() })
    expect(fetchHistory).toHaveBeenCalledWith(expect.stringContaining('/revisions'), { cache: 'no-store' })
    expect(container.textContent).toContain('版本 2 · 创作者 · 修改')
  })

  it('compares fields using the original form normalization', () => {
    const character = fixture(1, '甲').character
    character.birthday = '2000-3-2'
    expect(editablePatch(character, { name: '新名字', birthday: '2000-03-02', aliases: [] })).toEqual({ name: '新名字' })
  })
})

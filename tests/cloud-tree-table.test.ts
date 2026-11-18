import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WorkspaceTreeTable } from '@/features/tree-table/cloud/WorkspaceTreeTable'
import { buildDefaultCharacter } from '@/features/characters/services'
import { buildDefaultCountry } from '@/features/countries/services'
import { newCharacterData, newCountryData } from '@/lib/entity-defaults'
import type { OriginalCharacterSnapshot, OriginalCharactersCloudAdapter } from '@/lib/cloud/adapters/original-characters'
import type { OriginalCountrySnapshot, OriginalCountriesCloudAdapter } from '@/lib/cloud/adapters/original-countries'
import type { OriginalEventsCloudAdapter } from '@/lib/cloud/adapters/original-events'
import type { OriginalNotesCloudAdapter } from '@/lib/cloud/adapters/original-notes'
import { flushPendingSaves } from '@/lib/pending-saves'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const workspaceId = '11111111-1111-4111-8111-111111111111'
let root: Root
let element: HTMLDivElement
const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const character: OriginalCharacterSnapshot = {
  workspaceId, entityId: id(1), version: 1,
  character: { ...buildDefaultCharacter({ ...newCharacterData(), name: '云端角色', race: '人类', countryId: 2 }), id: 1 },
}
const country: OriginalCountrySnapshot = {
  workspaceId, entityId: id(2), version: 1,
  entity: { ...buildDefaultCountry({ ...newCountryData(), name: '云端国家' }), id: 2 },
}
const save = vi.fn(async (row: OriginalCharacterSnapshot, patch: Record<string, unknown>) => ({
  ...row, version: row.version + 1, character: { ...row.character, ...patch },
}))
const create = vi.fn(async () => ({
  ...character, entityId: id(3), character: { ...character.character, id: 3, name: '新角色' },
}))
const fake = { save, create } as unknown as OriginalCharactersCloudAdapter
const countryAdapter = { save: vi.fn(), create: vi.fn() } as unknown as OriginalCountriesCloudAdapter
const eventAdapter = { save: vi.fn(), create: vi.fn() } as unknown as OriginalEventsCloudAdapter
const noteAdapter = { save: vi.fn(), create: vi.fn() } as unknown as OriginalNotesCloudAdapter
const navigate = vi.fn()
const refresh = vi.fn(async () => undefined)

function Fixture({ canEdit }: { canEdit: boolean }) {
  const [characters, setCharacters] = useState([character])
  return React.createElement(WorkspaceTreeTable, {
    characters, countries: [country], events: [], notes: [],
    characterAdapter: fake, countryAdapter, eventAdapter, noteAdapter,
    onCharacterCreated: row => setCharacters(current => [...current, row]),
    onCharacterSaved: row => setCharacters(current => current.map(item => item.entityId === row.entityId ? row : item)),
    onCountryCreated: () => undefined, onCountrySaved: () => undefined,
    onEventCreated: () => undefined, onEventSaved: () => undefined,
    onNoteCreated: () => undefined, onNoteSaved: () => undefined,
    onRefresh: refresh, onNavigate: navigate, canEdit, disabled: false, loading: false,
  })
}

function button(label: string): HTMLButtonElement {
  const found = [...element.querySelectorAll<HTMLButtonElement>('button')].find(item =>
    item.textContent?.trim() === label)
  if (!found) throw new Error('Button missing: ' + label)
  return found
}
async function click(node: HTMLElement) {
  await act(async () => { node.click(); await Promise.resolve() })
}

beforeEach(() => {
  localStorage.removeItem('oc-tree-table-tab-order')
  vi.clearAllMocks()
  element = document.createElement('div')
  document.body.append(element)
  root = createRoot(element)
})
afterEach(async () => {
  await act(async () => root.unmount())
  element.remove()
})

describe('workspace tree-table using original row and tab UI', () => {
  it('displays workspace records with upstream country groups and navigates to editor', async () => {
    await act(async () => { root.render(React.createElement(Fixture, { canEdit: true })) })
    expect(element.textContent).toContain('云端角色')
    expect(element.textContent).toContain('云端国家')
    expect(element.textContent).toContain('角色 / 国家')
    const row = [...element.querySelectorAll('tr')].find(item => item.textContent?.includes('云端角色'))
    expect(row).toBeDefined()
    await click(row!)
    expect(navigate).toHaveBeenCalledWith('character', 1)
  })
  it('keeps viewers read-only with no cloud writes or new entries', async () => {
    await act(async () => { root.render(React.createElement(Fixture, { canEdit: false })) })
    const name = button('云端角色')
    expect(name.disabled).toBe(true)
    expect(element.textContent).not.toContain('新增')
    await click(name)
    expect(element.querySelector('input[aria-label="角色名"]')).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })
  it('creates an entity with the authenticated cloud adapter and updates the shared list', async () => {
    await act(async () => { root.render(React.createElement(Fixture, { canEdit: true })) })
    await click(button('新增'))
    expect(create).toHaveBeenCalledOnce()
    expect(element.textContent).toContain('新角色')
  })
  it('tracks an unsaved inline edit across section-switch flushes', async () => {
    await act(async () => { root.render(React.createElement(Fixture, { canEdit: true })) })
    await click(button('云端角色'))
    const input = element.querySelector('input[aria-label="角色名"]') as HTMLInputElement
    expect(input).not.toBeNull()
    await expect(flushPendingSaves()).rejects.toThrow('正在编辑的单元格')
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })) })
    await expect(flushPendingSaves()).resolves.toBeUndefined()
  })
})

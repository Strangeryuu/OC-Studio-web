import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { OriginalCharacterSnapshot } from '@/lib/cloud/adapters/original-characters'
import { buildDefaultCharacter } from '@/features/characters/services'
import { newCharacterData } from '@/lib/entity-defaults'
import * as characters from '@/features/characters/services'
import * as countries from '@/features/countries/services'
import * as world from '@/features/world/services'
import type { Editor } from '@tiptap/core'
import { flushPendingSaves } from '@/lib/pending-saves'

const fake = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/cloud/adapters/original-characters', () => ({
  OriginalCharactersCloudAdapter: class {
    list = fake.list
    save = fake.save
    create = fake.create
  },
}))
vi.mock('@/components/shared/toaster', () => ({ Toaster: () => null }))
vi.mock('@/components/shared/ImageCropper', async () => {
  const React = await import('react')
  return { ImageCropper: ({ open, onComplete }: { open: boolean; onComplete: (blob: Blob) => void }) =>
    open ? React.createElement('button', { type: 'button', onClick: () => onComplete(new Blob(['test'], { type: 'image/png' })) }, '完成裁剪') : null }
})

import { WorkspaceCharacters, editablePatch, hasNewBodyImages } from '@/features/characters/cloud/WorkspaceCharacters'

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
  it('adds a relationship using the original picker and saves the original fields', async () => {
    fake.list.mockResolvedValue([fixture(1, '关系甲'), fixture(2, '关系乙')])
    fake.save.mockImplementation(async (snapshot: OriginalCharacterSnapshot, patch: Record<string, unknown>) => ({
      ...snapshot, version: snapshot.version + 1, character: { ...snapshot.character, ...patch },
    }))
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'editor' })); await Promise.resolve() })
    await click(button('关系甲'))
    const section = [...container.querySelectorAll('section')].find(item => item.querySelector('h3')?.textContent === '角色关系')!
    await click([...section.querySelectorAll('button')].find(item => item.textContent?.trim() === '添加')!)
    const candidate = [...document.body.querySelectorAll('button')].find(item => item.textContent?.trim() === '关系乙' && !container.contains(item))!
    expect(candidate).toBeTruthy()
    await click(candidate)
    await click(button('保存'))
    expect(fake.save.mock.calls[0][1].relatedCharacters).toEqual([expect.objectContaining({ characterId: 2, name: '关系乙' })])
  })

  it('keeps existing body images while stopping unsynchronized new images', () => {
    const image = (src: string) => ({ type: 'imageBlock', attrs: { src } })
    const original = { type: 'doc', content: [image('/api/media/existing')] }
    expect(hasNewBodyImages(JSON.stringify(original), original)).toBe(false)
    expect(hasNewBodyImages(original, { type: 'doc', content: [image('blob:temporary')] })).toBe(true)
    expect(hasNewBodyImages(original, { type: 'doc', content: [image('/api/media/33333333-3333-4333-8333-333333333333')] })).toBe(false)
  })

  it('uploads a body image into the selected cloud workspace before saving it', async () => {
    fake.list.mockResolvedValue([fixture(1, '图片角色')])
    fake.save.mockImplementation(async (snapshot: OriginalCharacterSnapshot, patch: Record<string, unknown>) => ({
      ...snapshot, version: snapshot.version + 1, character: { ...snapshot.character, ...patch },
    }))
    const imageUrl = '/api/media/33333333-3333-4333-8333-333333333333'
    const upload = vi.fn().mockResolvedValue(new Response(JSON.stringify({ asset: { url: imageUrl } }), { status: 201 }))
    vi.stubGlobal('fetch', upload)
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'editor' })); await Promise.resolve() })
    await click(button('图片角色'))
    const input = container.querySelector('input[aria-label="上传正文图片"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['image'], 'test.png', { type: 'image/png' })] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); await Promise.resolve() })
    expect(upload).toHaveBeenCalledWith(`/api/workspaces/${workspaceId}/media`, expect.objectContaining({ method: 'POST' }))
    await click(button('保存'))
    expect(JSON.stringify(fake.save.mock.calls[0][1])).toContain(imageUrl)
  })

  it('reuses the original cover cropper and saves the private cloud URL', async () => {
    fake.list.mockResolvedValue([fixture(1, '封面角色')])
    fake.save.mockImplementation(async (snapshot: OriginalCharacterSnapshot, patch: Record<string, unknown>) => ({
      ...snapshot, version: snapshot.version + 1, character: { ...snapshot.character, ...patch },
    }))
    const imageUrl = '/api/media/33333333-3333-4333-8333-333333333333'
    const upload = vi.fn().mockResolvedValue(new Response(JSON.stringify({ asset: { url: imageUrl } }), { status: 201 }))
    vi.stubGlobal('fetch', upload)
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'editor' })); await Promise.resolve() })
    await click(button('封面角色'))
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['image'], 'test.png', { type: 'image/png' })] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); await Promise.resolve() })
    await click(button('完成裁剪'))
    expect(upload).toHaveBeenCalledWith(`/api/workspaces/${workspaceId}/media`, expect.objectContaining({ method: 'POST' }))
    await click(button('保存'))
    expect(fake.save.mock.calls[0][1]).toEqual({ headerUrl: imageUrl })
  })

  it('reuses the original avatar cropper and saves the private cloud URL', async () => {
    fake.list.mockResolvedValue([fixture(1, '头像角色')])
    fake.save.mockImplementation(async (snapshot: OriginalCharacterSnapshot, patch: Record<string, unknown>) => ({
      ...snapshot, version: snapshot.version + 1, character: { ...snapshot.character, ...patch },
    }))
    const imageUrl = '/api/media/33333333-3333-4333-8333-333333333333'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ asset: { url: imageUrl } }), { status: 201 })))
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'editor' })); await Promise.resolve() })
    await click(button('头像角色'))
    const input = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['image'], 'avatar.png', { type: 'image/png' })] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); await Promise.resolve() })
    await click(button('完成裁剪'))
    await click(button('保存'))
    expect(fake.save.mock.calls[0][1]).toEqual({ avatarUrl: imageUrl })
  })

  it('uploads through the original gallery and saves the resulting image', async () => {
    fake.list.mockResolvedValue([fixture(1, '相册角色')])
    fake.save.mockImplementation(async (snapshot: OriginalCharacterSnapshot, patch: Record<string, unknown>) => ({
      ...snapshot, version: snapshot.version + 1, character: { ...snapshot.character, ...patch },
    }))
    const imageUrl = '/api/media/33333333-3333-4333-8333-333333333333'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ asset: { url: imageUrl } }), { status: 201 })))
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', { configurable: true, value: [new File(['image'], 'gallery.png', { type: 'image/png' })] })
      this.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'editor' })); await Promise.resolve() })
    await click(button('相册角色'))
    const adds = [...container.querySelectorAll('button')].filter(item => item.textContent?.trim() === '添加')
    expect(adds).toHaveLength(2)
    await click(adds[1])
    await click(button('保存'))
    expect(fake.save.mock.calls[0][1]).toEqual({ gallery: [{ url: imageUrl, caption: '' }] })
  })

  it('retains gallery image addresses in a conflicting draft', async () => {
    fake.list.mockResolvedValue([fixture(1, '相册角色')])
    fake.save.mockRejectedValue(new Error('版本冲突'))
    const imageUrl = '/api/media/33333333-3333-4333-8333-333333333333'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ asset: { url: imageUrl } }), { status: 201 })))
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', { configurable: true, value: [new File(['image'], 'gallery.png', { type: 'image/png' })] })
      this.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'editor' })); await Promise.resolve() })
    await click(button('相册角色'))
    const adds = [...container.querySelectorAll('button')].filter(item => item.textContent?.trim() === '添加')
    await click(adds[1])
    await click(button('保存'))
    expect((container.querySelector('textarea[aria-label="当前草稿"]') as HTMLTextAreaElement).value).toContain(imageUrl)
  })

  it('crops and uploads a portrait through the original gallery', async () => {
    fake.list.mockResolvedValue([fixture(1, '立绘角色')])
    fake.save.mockImplementation(async (snapshot: OriginalCharacterSnapshot, patch: Record<string, unknown>) => ({
      ...snapshot, version: snapshot.version + 1, character: { ...snapshot.character, ...patch },
    }))
    const imageUrl = '/api/media/33333333-3333-4333-8333-333333333333'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ asset: { url: imageUrl } }), { status: 201 })))
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', { configurable: true, value: [new File(['image'], 'portrait.png', { type: 'image/png' })] })
      this.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'editor' })); await Promise.resolve() })
    await click(button('立绘角色'))
    const adds = [...container.querySelectorAll('button')].filter(item => item.textContent?.trim() === '添加')
    await click(adds[0])
    await click(button('完成裁剪'))
    await click(button('保存'))
    expect(fake.save.mock.calls[0][1]).toEqual({ avatars: [{ url: imageUrl, type: 'portrait' }] })
  })

  it('keeps a failed cover upload out of the character', async () => {
    fake.list.mockResolvedValue([fixture(1, '封面角色')])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 413 })))
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'editor' })); await Promise.resolve() })
    await click(button('封面角色'))
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['image'], 'test.png', { type: 'image/png' })] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); await Promise.resolve() })
    await click(button('完成裁剪'))
    expect(container.textContent).toContain('图片上传失败')
    expect(fake.save).not.toHaveBeenCalled()
    expect(container.querySelector('img[src^="/api/media/"]')).toBeNull()
  })

  it('blocks leaving while a profile image upload is in progress', async () => {
    fake.list.mockResolvedValue([fixture(1, '甲'), fixture(2, '乙')])
    let resolveUpload!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveUpload = resolve })))
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'editor' })); await Promise.resolve() })
    await click(button('甲'))
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['image'], 'test.png', { type: 'image/png' })] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); await Promise.resolve() })
    await click(button('完成裁剪'))
    expect(button('乙').disabled).toBe(true)
    await expect(flushPendingSaves()).rejects.toThrow('图片正在上传')
    await act(async () => {
      resolveUpload(new Response(JSON.stringify({ asset: { url: '/api/media/33333333-3333-4333-8333-333333333333' } }), { status: 201 }))
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })
    expect(button('乙').disabled).toBe(false)
  })

  it('keeps the editor open and blocks leaving while an image is uploading', async () => {
    fake.list.mockResolvedValue([fixture(1, '甲'), fixture(2, '乙')])
    fake.save.mockImplementation(async (snapshot: OriginalCharacterSnapshot, patch: Record<string, unknown>) => ({
      ...snapshot, version: snapshot.version + 1, character: { ...snapshot.character, ...patch },
    }))
    let resolveUpload!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveUpload = resolve })))
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'editor' })); await Promise.resolve() })
    await click(button('甲'))
    const input = container.querySelector('input[aria-label="上传正文图片"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['image'], 'test.png', { type: 'image/png' })] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    expect(button('乙').disabled).toBe(true)
    await expect(flushPendingSaves()).rejects.toThrow('图片正在上传')
    await act(async () => {
      resolveUpload(new Response(JSON.stringify({ asset: { url: '/api/media/33333333-3333-4333-8333-333333333333' } }), { status: 201 }))
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })
    expect(button('乙').disabled).toBe(false)
    await click(button('乙'))
    expect(JSON.stringify(fake.save.mock.calls[0][1])).toContain('/api/media/33333333-3333-4333-8333-333333333333')
  })

  it('shows upload failures without inserting an unsaved image', async () => {
    fake.list.mockResolvedValue([fixture(1, '角色')])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 413 })))
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'editor' })); await Promise.resolve() })
    await click(button('角色'))
    const input = container.querySelector('input[aria-label="上传正文图片"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['image'], 'test.png', { type: 'image/png' })] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); await Promise.resolve() })
    expect(container.textContent).toContain('图片上传失败')
    const editor = (container.querySelector('.tiptap') as HTMLElement & { editor: Editor }).editor
    expect(JSON.stringify(editor.getJSON())).not.toContain('imageBlock')
  })
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
    const name = container.querySelector('input:not([type="file"])') as HTMLInputElement
    expect(name.value).toBe('初始角色')
    await inputText(name, '修改角色')
    await click(button('初始角色'))
    expect((container.querySelector('input:not([type="file"])') as HTMLInputElement).value).toBe('修改角色')
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
    const name = container.querySelector('input:not([type="file"])') as HTMLInputElement
    await inputText(name, '未保存草稿')
    await click(button('保存'))
    expect(container.textContent).toContain('版本冲突')
    expect((container.querySelector('textarea[aria-label="当前草稿"]') as HTMLTextAreaElement).value).toContain('未保存草稿')
    await click(button('乙'))
    expect((container.querySelector('input:not([type="file"])') as HTMLInputElement).value).toBe('未保存草稿')
  })

  it('renders viewer fields disabled and omits create and save', async () => {
    const item = fixture(1, '只读角色')
    item.character.avatarUrl = '/api/media/33333333-3333-4333-8333-333333333333'
    fake.list.mockResolvedValue([item])
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'viewer' })); await Promise.resolve() })
    await click(button('只读角色'))
    expect(container.querySelector('fieldset')?.disabled).toBe(true)
    expect(container.querySelector('img[src="/api/media/33333333-3333-4333-8333-333333333333"]')).not.toBeNull()
    const editor = (container.querySelector('.tiptap') as HTMLElement & { editor: Editor }).editor
    expect(editor.isEditable).toBe(false)
    expect([...container.querySelectorAll('button')].map(item => item.textContent)).not.toContain('保存')
    expect([...container.querySelectorAll('button')].map(item => item.textContent)).not.toContain('新建角色')
    expect([...container.querySelectorAll('button')].some(item => item.textContent?.trim() === '添加')).toBe(false)
  })

  it('saves the original rich-text editor document through the cloud adapter', async () => {
    const original = fixture(1, '正文角色')
    fake.list.mockResolvedValue([original])
    fake.save.mockImplementation(async (snapshot: OriginalCharacterSnapshot, patch: Record<string, unknown>) => ({
      ...snapshot, version: snapshot.version + 1, character: { ...snapshot.character, ...patch },
    }))
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'editor' })); await Promise.resolve() })
    await click(button('正文角色'))
    const editor = (container.querySelector('.tiptap') as HTMLElement & { editor: Editor }).editor
    await act(async () => { editor.commands.insertContent('云端正文'); await Promise.resolve() })
    await click(button('保存'))
    expect(fake.save).toHaveBeenCalledOnce()
    const patch = fake.save.mock.calls[0][1] as { document: unknown }
    expect(JSON.stringify(patch.document)).toContain('云端正文')
  })

  it('keeps the edited body available for copying after a conflict', async () => {
    fake.list.mockResolvedValue([fixture(1, '正文角色')])
    fake.save.mockRejectedValue(new Error('版本冲突'))
    await act(async () => { root.render(React.createElement(WorkspaceCharacters, { workspaceId, role: 'editor' })); await Promise.resolve() })
    await click(button('正文角色'))
    const editor = (container.querySelector('.tiptap') as HTMLElement & { editor: Editor }).editor
    await act(async () => { editor.commands.insertContent('未保存正文'); await Promise.resolve() })
    await click(button('保存'))
    const draft = container.querySelector('textarea[aria-label="当前草稿"]') as HTMLTextAreaElement
    expect(draft.value).toContain('未保存正文')
    expect(editor.getText()).toContain('未保存正文')
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

  it('preserves portrait types and gallery captions when pictures are edited', () => {
    const character = fixture(1, '甲').character
    character.avatars = [{ url: 'old-a', type: 'fullbody' }, { url: 'old-b', type: 'other' }]
    character.gallery = [{ url: 'old-c', caption: '旧说明' }]
    const patch = editablePatch(character, {
      avatars: [{ url: 'old-b', type: 'portrait' }, { url: 'old-a', type: 'portrait' }],
      gallery: [{ url: 'new-c', caption: '' }],
    })
    expect(patch.avatars).toEqual([{ url: 'old-b', type: 'other' }, { url: 'old-a', type: 'fullbody' }])
    expect(patch.gallery).toEqual([{ url: 'new-c', caption: '旧说明' }])
  })
})

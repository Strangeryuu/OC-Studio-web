import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudMediaDownloadName, downloadMediaFile } from '@/lib/media-download'

const asset = '/api/media/11111111-1111-4111-8111-111111111111'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('cloud private media downloads', () => {
  it('uses the original media save flow with safe names and server MIME', async () => {
    expect(cloudMediaDownloadName('角色/立绘', 'image/png')).toBe('角色-立绘.png')
    expect(cloudMediaDownloadName('头像.jpeg', 'image/webp')).toBe('头像.webp')
    expect(cloudMediaDownloadName('../世界:封面', 'image/jpeg')).toBe('..-世界-封面.jpg')
    expect(() => cloudMediaDownloadName('test', 'application/json')).toThrow('媒体类型')
  })
  it('reads private asset bytes with same-origin credentials and meaningful extension', async () => {
    vi.useFakeTimers()
    const fetcher=vi.fn(async () => new Response(new Uint8Array([137,80,78,71]), {
      status:200, headers:{'Content-Type':'image/png'},
    }))
    vi.stubGlobal('fetch',fetcher)
    const nativeClick=HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click=vi.fn()
    const originalCreate=URL.createObjectURL
    const originalRevoke=URL.revokeObjectURL
    URL.createObjectURL=vi.fn(()=>'blob:cloud-download')
    URL.revokeObjectURL=vi.fn()
    try {
      const saved=await downloadMediaFile(asset,'角色立绘')
      expect(saved).toBe('角色立绘.png')
      expect(fetcher).toHaveBeenCalledWith(asset,{credentials:'same-origin'})
      expect(URL.createObjectURL).toHaveBeenCalledOnce()
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce()
    } finally {
      HTMLAnchorElement.prototype.click=nativeClick
      URL.createObjectURL=originalCreate
      URL.revokeObjectURL=originalRevoke
    }
  })
  it('surfaces private-media authorization and media-type failures', async () => {
    const fetcher=vi.fn(async () => new Response('',{status:403}))
    vi.stubGlobal('fetch',fetcher)
    await expect(downloadMediaFile(asset,'秘密相册')).rejects.toThrow('HTTP 403')
    fetcher.mockImplementation(async () => new Response('no',{status:200,headers:{
      'Content-Type':'text/html',
    }}))
    await expect(downloadMediaFile(asset,'秘密相册')).rejects.toThrow('媒体类型')
  })
})

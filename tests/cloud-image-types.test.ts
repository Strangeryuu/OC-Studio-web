import { describe, expect, it } from 'vitest'
import { detectAllowedImage, MAX_UPLOAD_BYTES } from '@/lib/cloud/image-types'

describe('private cloud image validation', () => {
  it('detects png, jpeg, webp, and animated gif signatures', () => {
    expect(detectAllowedImage(new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]))?.mime).toBe('image/png')
    expect(detectAllowedImage(new Uint8Array([255,216,255,0,0,0,0,0,0,0,0,0]))?.extension).toBe('jpg')
    expect(detectAllowedImage(new TextEncoder().encode('RIFF0000WEBP'))?.mime).toBe('image/webp')
    expect(detectAllowedImage(new TextEncoder().encode('GIF89a000000'))?.mime).toBe('image/gif')
  })
  it('rejects svg / executable signatures and enforces an 8 MB limit', () => {
    expect(detectAllowedImage(new TextEncoder().encode('<svg>...</svg>'))).toBeNull()
    expect(detectAllowedImage(new TextEncoder().encode('MZ random data'))).toBeNull()
    expect(MAX_UPLOAD_BYTES).toBe(8 * 1024 * 1024)
  })
})

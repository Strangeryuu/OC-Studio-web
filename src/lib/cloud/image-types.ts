export type AllowedImage = { mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; extension: 'png' | 'jpg' | 'webp' | 'gif' }

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

/** Verify binary signatures rather than trusting a user-supplied filename or MIME. */
export function detectAllowedImage(bytes: Uint8Array): AllowedImage | null {
  if (bytes.length < 12) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { mime: 'image/png', extension: 'png' }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', extension: 'jpg' }
  }
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return { mime: 'image/webp', extension: 'webp' }
  }
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') {
    return { mime: 'image/gif', extension: 'gif' }
  }
  return null
}

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { graphConnectionBehavior } from '@/features/relations/mobile-connection'

describe('React Flow mobile connection permissions and gestures', () => {
  it('allows drag from mobile handles and touch two-tap fallback for editors', () => {
    expect(graphConnectionBehavior(true, true)).toEqual({
      nodesConnectable: true,
      connectOnClick: true,
      connectionRadius: 64,
    })
  })
  it('preserves the original desktop drag-only connection UX', () => {
    expect(graphConnectionBehavior(false, true)).toEqual({
      nodesConnectable: true,
      connectOnClick: false,
      connectionRadius: 48,
    })
  })
  it('keeps both mobile and desktop viewer handles read-only', () => {
    expect(graphConnectionBehavior(true, false)).toEqual({
      nodesConnectable: false,
      connectOnClick: false,
      connectionRadius: 64,
    })
    expect(graphConnectionBehavior(false, false).nodesConnectable).toBe(false)
  })
})

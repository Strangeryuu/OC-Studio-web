import { describe, expect, it } from 'vitest'
import { drawMapAnnotations } from '@/features/map/export'
import type { MapAnnotation } from '@/features/map/annotations'

describe('cloud map annotation export', () => {
  it('draws borders as closed filled polygons, roads as dashed lines, retaining normalized coordinates', () => {
    const calls: string[] = []
    const ctx = {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      beginPath: () => calls.push('begin'),
      moveTo: (x: number, y: number) => calls.push(`move:${x},${y}`),
      lineTo: (x: number, y: number) => calls.push(`line:${x},${y}`),
      closePath: () => calls.push('closed'),
      fill: () => calls.push('fill'),
      stroke: () => calls.push('stroke'),
      setLineDash: (values: number[]) => calls.push('dash:' + values.join(',')),
      globalAlpha: 1, lineWidth: 1, fillStyle: '', strokeStyle: '',
      lineJoin: 'miter', lineCap: 'butt',
    } as unknown as CanvasRenderingContext2D
    const items: MapAnnotation[] = [
      { id: 'b', kind: 'border', points: [{x:0.2,y:0.1},{x:0.9,y:0.1},{x:0.5,y:0.9}], fill:'苔绿', color:'赤陶' },
      { id: 'r', kind: 'road', points: [{x:0.1,y:0.2},{x:0.7,y:0.8}], color:'靛蓝' },
    ]
    drawMapAnnotations(ctx, items, 1000, 500, 2)
    expect(calls).toContain('move:200,50')
    expect(calls).toContain('line:900,50')
    expect(calls).toContain('move:100,100')
    expect(calls).toContain('line:700,400')
    expect(calls.filter(c => c === 'closed')).toHaveLength(1)
    expect(calls.filter(c => c === 'fill')).toHaveLength(1)
    expect(calls.filter(c => c === 'stroke')).toHaveLength(4)
    expect(calls).toContain('dash:12,8')
    expect(calls.filter(c => c === 'save')).toHaveLength(2)
    expect(calls.filter(c => c === 'restore')).toHaveLength(2)
  })
  it('ignores incomplete annotations and invalid canvas size', () => {
    const ctx = { save: () => { throw new Error('unexpected draw') } } as unknown as CanvasRenderingContext2D
    drawMapAnnotations(ctx, [{ id:'x',kind:'border',points:[{x:0,y:0}] }], 200, 100)
    drawMapAnnotations(ctx, [{id:'x',kind:'road',points:[{x:0,y:0},{x:1,y:1}]}], 0, 0)
  })
})

'use client'

import { useMemo } from 'react'
import {
  ReactFlow, Background, Controls, MarkerType, type Node, type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { CloudCharacterRelation, CloudRelationCandidate, CloudInboundRelation } from '@/lib/cloud/character-links'

type Link = { source: string; target: string; relation: string; arrow: 'none' | 'forward' | 'backward' | 'both' }

export function CloudRelationGraph({ workspaceId, characters, links, centerId }: {
  workspaceId: string
  characters: CloudRelationCandidate[]
  links: Link[]
  centerId?: string
}) {
  const { nodes, edges } = useMemo(() => {
    const used = new Set<string>()
    links.forEach(link => { used.add(link.source); used.add(link.target) })
    if (centerId) used.add(centerId)
    const selected = characters.filter(character => used.has(character.id))
    const radius = Math.max(180, selected.length * 19)
    const nodes: Node[] = selected.map((character, index) => {
      const angle = 2 * Math.PI * index / Math.max(1, selected.length)
      return {
        id: character.id, position: {
          x: Math.cos(angle) * radius + radius + 80,
          y: Math.sin(angle) * radius + radius + 80,
        },
        data: { label: character.title },
        style: {
          borderRadius: 10, backgroundColor: 'var(--oc-paper)',
          border: '1px solid var(--oc-line)', padding: 10, width: 150,
        },
      }
    })
    const edges: Edge[] = links
      .filter(link => selected.some(c => c.id === link.source) && selected.some(c => c.id === link.target))
      .map((link, index) => ({
        id: 'cloud-edge-' + index + '-' + link.source + '-' + link.target,
        source: link.source, target: link.target, label: link.relation, type: 'smoothstep',
        markerEnd: ['forward', 'both'].includes(link.arrow) ? { type: MarkerType.ArrowClosed } : undefined,
        markerStart: ['backward', 'both'].includes(link.arrow) ? { type: MarkerType.ArrowClosed } : undefined,
        labelStyle: { fontSize: 11 },
      }))
    return { nodes, edges }
  }, [characters, links, centerId])

  return <div className="overflow-hidden rounded-lg border border-[var(--oc-line)]">
    <div className="h-[380px] w-full">
      <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false}
        nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}>
        <Background gap={18}/>
        <Controls showInteractive={false}/>
      </ReactFlow>
    </div>
    <p className="border-t border-[var(--oc-line)] px-3 py-2 text-xs opacity-70">
      关系图只展示已存储的云端命名关系；可在当前角色的「人物关系」组件中添加或修改。其他世界观的角色数据不会出现在此图。
    </p>
  </div>
}

/** Build the current character neighbourhood, including inbound relationships.
 * The original Dexie graph remains separate while the UUID cloud adapter is built.
 */
export function localCloudGraph(
  selfId: string, relations: CloudCharacterRelation[], inbound: CloudInboundRelation[],
): Link[] {
  return [
    ...relations.map(r => ({ source: selfId, target: r.targetId, relation: r.relation, arrow: r.arrow })),
    ...inbound.map(r => ({
      source: r.sourceId, target: selfId, relation: r.relation, arrow: 'none' as const,
    })),
  ]
}

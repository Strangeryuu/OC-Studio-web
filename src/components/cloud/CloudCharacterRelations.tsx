'use client'
import { useMemo, useState, type FormEvent } from 'react'
import { GitBranch, Plus, Trash2 } from 'lucide-react'
import { CloudRelationGraph, localCloudGraph } from './CloudRelationGraph'
import type {
  CloudCharacterRelation, CloudRelationArrow, CloudRelationCandidate, CloudInboundRelation,
} from '@/lib/cloud/character-links'

const ARROW_LABEL: Record<CloudRelationArrow, string> = {
  none: '无方向', forward: '指向对方', backward: '指向自己', both: '双向',
}

export function CloudCharacterRelations({ workspaceId, characterId, relations, candidates, inbound, editable, onChange }: {
  workspaceId: string
  characterId: string
  relations: CloudCharacterRelation[]
  candidates: CloudRelationCandidate[]
  inbound: CloudInboundRelation[]
  editable: boolean
  onChange: (next: CloudCharacterRelation[]) => void
}) {
  const [target, setTarget] = useState('')
  const [label, setLabel] = useState('')
  const [arrow, setArrow] = useState<CloudRelationArrow>('both')
  const [showGraph, setShowGraph] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titles = useMemo(() => new Map(candidates.map(c => [c.id, c.title])), [candidates])
  const selectable = candidates.filter(c => c.id !== characterId)

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editable || !target || target === characterId || !titles.has(target) ||
      !label.trim() || label.trim().length > 60 || relations.length >= 100) {
      setError('请选择有效的本世界观角色，关系名最长 60 字，单角色最多 100 条关系。')
      return
    }
    onChange([...relations, { id: crypto.randomUUID(), targetId: target, relation: label.trim(), arrow }])
    setLabel('')
    setTarget('')
    setError(null)
  }

  return <section className="rounded-lg border border-[var(--oc-line)] p-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><GitBranch size={18}/>人物关系</h2>
      <button type="button" onClick={() => setShowGraph(x => !x)}
        className="rounded border border-[var(--oc-line)] px-3 py-2 text-sm">
        {showGraph ? '返回关系列表' : '查看关系图'}
      </button>
    </div>
    <p className="mb-4 text-xs opacity-70">
      可建立多条命名关系，分别设定箭头方向。关系与修改历史一起保存；目前关系图是只读预览。
    </p>
    {error && <p role="alert" className="mb-3 text-sm">{error}</p>}
    {showGraph ? <CloudRelationGraph workspaceId={workspaceId}
      characters={candidates} centerId={characterId} links={localCloudGraph(characterId, relations, inbound)} /> :
    <div className="flex flex-col gap-3">
      {relations.map(relation => <div key={relation.id}
        className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--oc-line)] p-3 text-sm">
        <span className="min-w-0 flex-1 font-medium">{titles.get(relation.targetId) ?? '已删除或不可见角色'}</span>
        <input aria-label="关系名称" value={relation.relation} maxLength={60} disabled={!editable}
          onChange={event => onChange(relations.map(r => r.id === relation.id ? { ...r, relation: event.target.value } : r))}
          className="min-w-32 rounded border border-[var(--oc-line)] bg-transparent p-2" />
        <select aria-label="关系箭头" value={relation.arrow} disabled={!editable}
          onChange={event => onChange(relations.map(r => r.id === relation.id ? { ...r, arrow: event.target.value as CloudRelationArrow } : r))}
          className="rounded border border-[var(--oc-line)] bg-[var(--oc-paper)] p-2">
          {(Object.keys(ARROW_LABEL) as CloudRelationArrow[]).map(key =>
            <option key={key} value={key}>{ARROW_LABEL[key]}</option>)}
        </select>
        {editable && <button type="button" aria-label="移除这条关系"
          onClick={() => onChange(relations.filter(r => r.id !== relation.id))}><Trash2 size={16}/></button>}
      </div>)}
      {relations.length === 0 && <p className="text-sm opacity-60">尚未建立关系</p>}
      {inbound.length > 0 && <div className="mt-2 border-t border-[var(--oc-line)] pt-3">
        <p className="mb-2 text-sm font-semibold">其他角色提及此角色（只读）</p>
        {inbound.map((relation, index) => <p key={relation.sourceId + '-' + index} className="py-1 text-sm">
          {relation.sourceTitle}：{relation.relation}
        </p>)}
      </div>}
      {editable && <form onSubmit={add} className="mt-2 grid gap-2 border-t border-[var(--oc-line)] pt-4 sm:grid-cols-[1fr_1fr_auto]">
        <label className="sr-only" htmlFor="cloud-relation-target">关系目标</label>
        <select id="cloud-relation-target" value={target} onChange={event => setTarget(event.target.value)}
          className="min-w-0 rounded border border-[var(--oc-line)] bg-[var(--oc-paper)] px-2 py-2 text-sm">
          <option value="">选择角色</option>
          {selectable.map(c => <option value={c.id} key={c.id}>{c.title}</option>)}
        </select>
        <input aria-label="新关系名称" required maxLength={60} value={label}
          onChange={event => setLabel(event.target.value)} placeholder="关系名称，如：表姐"
          className="min-w-0 rounded border border-[var(--oc-line)] bg-transparent p-2 text-sm" />
        <select aria-label="新关系方向" value={arrow} onChange={event => setArrow(event.target.value as CloudRelationArrow)}
          className="rounded border border-[var(--oc-line)] bg-[var(--oc-paper)] p-2 text-sm">
          {(Object.keys(ARROW_LABEL) as CloudRelationArrow[]).map(key =>
            <option key={key} value={key}>{ARROW_LABEL[key]}</option>)}
        </select>
        <button type="submit" disabled={!selectable.length || relations.length >= 100}
          className="inline-flex items-center justify-center gap-1 rounded border border-[var(--oc-line)] px-3 py-2 text-sm disabled:opacity-50">
          <Plus size={14}/>添加关系
        </button>
      </form>}
    </div>}
  </section>
}

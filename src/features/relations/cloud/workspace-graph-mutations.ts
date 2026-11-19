import type { Character, Country, Event, WorldEntry } from '@/types'
import type { OriginalCharacterPatch } from '@/lib/cloud/adapters/original-characters'
import type { OriginalEventPatch } from '@/lib/cloud/adapters/original-events'
import type { OriginalNotePatch } from '@/lib/cloud/adapters/original-notes'
import type { EdgeStylePatchInput, EdgeStyleSelection } from '../components/EdgeStylePanel'
import type { RelationEndpoint, RelationNodeType } from '../types'
import { applyEdgeStyle } from '../edge-style'

/**
 * Pure mutation planner for the cloud graph.
 * Writes the exact same original entity fields as the desktop graph.
 * The caller persists one versioned entity patch through the cloud adapter;
 * permissions, revision history and concurrency checks remain server-owned.
 */
export interface WorkspaceGraphEntities {
  characters: Character[]
  events: Event[]
  countries: Country[]
  notes: WorldEntry[]
}

export type WorkspaceGraphChange =
  | { type: 'character'; id: number; patch: OriginalCharacterPatch }
  | { type: 'event'; id: number; patch: OriginalEventPatch }
  | { type: 'world'; id: number; patch: OriginalNotePatch }

export type WorkspaceGraphPlan =
  | { ok: true; change: WorkspaceGraphChange | null }
  | { ok: false; reason: 'unsupported' | 'duplicate' | 'missing' }

const missing = (): WorkspaceGraphPlan => ({ ok: false, reason: 'missing' })
const unsupported = (): WorkspaceGraphPlan => ({ ok: false, reason: 'unsupported' })
const duplicate = (): WorkspaceGraphPlan => ({ ok: false, reason: 'duplicate' })
const change = (item: WorkspaceGraphChange): WorkspaceGraphPlan => ({ ok: true, change: item })

function find(entities: WorkspaceGraphEntities, type: RelationNodeType, id: number) {
  switch (type) {
    case 'character': return entities.characters.some(item => item.id === id)
    case 'event': return entities.events.some(item => item.id === id)
    case 'country': return entities.countries.some(item => item.id === id)
    case 'world': return entities.notes.some(item => item.id === id)
  }
}

function findCharacter(entities: WorkspaceGraphEntities, id: number) {
  return entities.characters.find(item => item.id === id)
}
function findEvent(entities: WorkspaceGraphEntities, id: number) {
  return entities.events.find(item => item.id === id)
}
function findNote(entities: WorkspaceGraphEntities, id: number) {
  return entities.notes.find(item => item.id === id)
}
function samePair(source: RelationEndpoint, target: RelationEndpoint) {
  return source.entityType === target.entityType && source.entityId === target.entityId
}

export function planWorkspaceRelationCreate(
  entities: WorkspaceGraphEntities,
  source: RelationEndpoint,
  target: RelationEndpoint,
  relation: string,
): WorkspaceGraphPlan {
  if (samePair(source, target)) return unsupported()
  if (!find(entities, source.entityType, source.entityId) ||
      !find(entities, target.entityType, target.entityId)) return missing()
  const name = relation.trim().slice(0, 40)
  const pair = source.entityType + ':' + target.entityType
  switch (pair) {
    case 'character:character': {
      if (!name) return unsupported()
      const from = findCharacter(entities, source.entityId)!
      const to = findCharacter(entities, target.entityId)!
      if (from.relatedCharacters.some(item => item.characterId === to.id &&
        item.relation.trim() === name)) return duplicate()
      return change({ type: 'character', id: from.id, patch: {
        relatedCharacters: [...from.relatedCharacters,
          { characterId: to.id, name: to.name, relation: name, arrow: 'both' }],
      } })
    }
    case 'event:event': {
      if (!name) return unsupported()
      const from = findEvent(entities, source.entityId)!
      if ((from.relations ?? []).some(item => item.targetId === target.entityId &&
        item.relation.trim() === name)) return duplicate()
      return change({ type: 'event', id: from.id, patch: {
        relations: [...(from.relations ?? []), { targetId: target.entityId, relation: name }],
      } })
    }
    case 'character:country':
    case 'country:character': {
      const characterId = source.entityType === 'character' ? source.entityId : target.entityId
      const countryId = source.entityType === 'country' ? source.entityId : target.entityId
      const character = findCharacter(entities, characterId)!
      if (character.countryId === countryId) return duplicate()
      return change({ type: 'character', id: characterId, patch: { countryId } })
    }
    case 'event:character':
    case 'character:event': {
      const eventId = source.entityType === 'event' ? source.entityId : target.entityId
      const characterId = source.entityType === 'character' ? source.entityId : target.entityId
      const event = findEvent(entities, eventId)!
      if (event.characters.includes(characterId)) return duplicate()
      return change({ type: 'event', id: eventId, patch: {
        characters: [...event.characters, characterId],
      } })
    }
    case 'event:country':
    case 'country:event': {
      const eventId = source.entityType === 'event' ? source.entityId : target.entityId
      const countryId = source.entityType === 'country' ? source.entityId : target.entityId
      const event = findEvent(entities, eventId)!
      if ((event.countries ?? []).includes(countryId)) return duplicate()
      return change({ type: 'event', id: eventId, patch: {
        countries: [...(event.countries ?? []), countryId],
      } })
    }
    // World relations are visible/editable when already present, but graph
    // creation follows the original relationPlan's supported combinations.
    default: return unsupported()
  }
}

function planNamedChange(
  entities: WorkspaceGraphEntities,
  source: RelationEndpoint,
  target: RelationEndpoint,
  relation: string,
  kind: 'remove' | 'patch',
  patch?: EdgeStylePatchInput,
): WorkspaceGraphPlan {
  const from = source.entityType
  const to = target.entityType
  if (from === 'character' && to === 'character') {
    const item = findCharacter(entities, source.entityId)
    const list = item?.relatedCharacters ?? []
    const index = list.findIndex(row => row.characterId === target.entityId && row.relation.trim() === relation.trim())
    if (item && index >= 0) {
      const next = [...list]
      if (kind === 'remove') next.splice(index, 1)
      else {
        const result = applyEdgeStyle(next[index], patch ?? {})
        if (!result.changed) return { ok: true, change: null }
        if (next.some((row, idx) => idx !== index &&
          row.characterId === target.entityId && row.relation.trim() === result.edge.relation?.trim())) return duplicate()
        next[index] = result.edge
      }
      return change({ type: 'character', id: item.id, patch: { relatedCharacters: next } })
    }
    return missing()
  }
  if (from === 'event' && to === 'event') {
    const item = findEvent(entities, source.entityId)
    const list = item?.relations ?? []
    const index = list.findIndex(row => row.targetId === target.entityId && row.relation.trim() === relation.trim())
    if (item && index >= 0) {
      const next = [...list]
      if (kind === 'remove') next.splice(index, 1)
      else {
        const result = applyEdgeStyle(next[index], patch ?? {})
        if (!result.changed) return { ok: true, change: null }
        if (next.some((row, idx) => idx !== index &&
          row.targetId === target.entityId && row.relation.trim() === result.edge.relation?.trim())) return duplicate()
        next[index] = result.edge
      }
      return change({ type: 'event', id: item.id, patch: { relations: next } })
    }
    return missing()
  }
  if (from === 'world' && to === 'world') {
    const item = findNote(entities, source.entityId)
    const list = item?.relations ?? []
    const index = list.findIndex(row => row.targetId === target.entityId && row.relation.trim() === relation.trim())
    if (item && index >= 0) {
      const next = [...list]
      if (kind === 'remove') next.splice(index, 1)
      else {
        const result = applyEdgeStyle(next[index], patch ?? {})
        if (!result.changed) return { ok: true, change: null }
        if (next.some((row, idx) => idx !== index &&
          row.targetId === target.entityId && row.relation.trim() === result.edge.relation?.trim())) return duplicate()
        next[index] = result.edge
      }
      return change({ type: 'world', id: item.id, patch: { relations: next } })
    }
    return missing()
  }
  if ((from === 'character' && to === 'world') || (from === 'world' && to === 'character')) {
    const characterId = from === 'character' ? source.entityId : target.entityId
    const noteId = from === 'world' ? source.entityId : target.entityId
    const item = findCharacter(entities, characterId)
    const list = item?.relatedNotes ?? []
    const index = list.findIndex(row => row.targetId === noteId && row.relation.trim() === relation.trim())
    if (item && index >= 0) {
      const next = [...list]
      if (kind === 'remove') next.splice(index, 1)
      else {
        const result = applyEdgeStyle(next[index], patch ?? {})
        if (!result.changed) return { ok: true, change: null }
        if (next.some((row, idx) => idx !== index &&
          row.targetId === noteId && row.relation.trim() === result.edge.relation?.trim())) return duplicate()
        next[index] = result.edge
      }
      return change({ type: 'character', id: item.id, patch: { relatedNotes: next } })
    }
    return missing()
  }
  return unsupported()
}

function removeMembership(
  entities: WorkspaceGraphEntities, source: RelationEndpoint, target: RelationEndpoint,
): WorkspaceGraphPlan {
  const pair = source.entityType + ':' + target.entityType
  switch (pair) {
    case 'character:country':
    case 'country:character': {
      const characterId = source.entityType === 'character' ? source.entityId : target.entityId
      const countryId = source.entityType === 'country' ? source.entityId : target.entityId
      const character = findCharacter(entities, characterId)
      if (!character || character.countryId !== countryId) return missing()
      return change({ type: 'character', id: character.id, patch: { countryId: null } })
    }
    case 'character:event':
    case 'event:character': {
      const eventId = source.entityType === 'event' ? source.entityId : target.entityId
      const characterId = source.entityType === 'character' ? source.entityId : target.entityId
      const event = findEvent(entities, eventId)
      if (!event || !event.characters.includes(characterId)) return missing()
      return change({ type: 'event', id: event.id, patch: {
        characters: event.characters.filter(id => id !== characterId),
      } })
    }
    case 'country:event':
    case 'event:country': {
      const eventId = source.entityType === 'event' ? source.entityId : target.entityId
      const countryId = source.entityType === 'country' ? source.entityId : target.entityId
      const event = findEvent(entities, eventId)
      if (!event || !(event.countries ?? []).includes(countryId)) return missing()
      return change({ type: 'event', id: event.id, patch: {
        countries: (event.countries ?? []).filter(id => id !== countryId),
      } })
    }
    default: return unsupported()
  }
}

export function planWorkspaceRelationDelete(
  entities: WorkspaceGraphEntities, selection: EdgeStyleSelection,
): WorkspaceGraphPlan {
  if (selection.kind === 'reference') return unsupported()
  const source: RelationEndpoint = { entityType: selection.sourceType, entityId: selection.sourceId }
  const target: RelationEndpoint = { entityType: selection.targetType, entityId: selection.targetId }
  if (selection.kind === 'member') return removeMembership(entities, source, target)
  const primary = planNamedChange(entities, source, target, selection.relation, 'remove')
  if (primary.ok || primary.reason !== 'missing' || source.entityType !== target.entityType) return primary
  return planNamedChange(entities, target, source, selection.relation, 'remove')
}

export function planWorkspaceRelationPatch(
  entities: WorkspaceGraphEntities, selection: EdgeStyleSelection, patch: EdgeStylePatchInput,
): WorkspaceGraphPlan {
  if (selection.kind === 'reference' || selection.kind === 'member') return unsupported()
  const source: RelationEndpoint = { entityType: selection.sourceType, entityId: selection.sourceId }
  const target: RelationEndpoint = { entityType: selection.targetType, entityId: selection.targetId }
  const primary = planNamedChange(entities, source, target, selection.relation, 'patch', patch)
  if (primary.ok || primary.reason !== 'missing' || source.entityType !== target.entityType) return primary
  return planNamedChange(entities, target, source, selection.relation, 'patch', patch)
}

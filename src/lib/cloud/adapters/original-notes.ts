import type { WorldEntry, GraphPosition } from '@/types'
import type { WorldFormData } from '@/features/world/types'
import { buildDefaultEntry } from '@/features/world/services'
import { newWorldEntryData } from '@/lib/entity-defaults'
import { OriginalEntityCloudAdapter, type Fetcher, type OriginalSnapshot, type RecordValue } from './original-entities'

export type OriginalNoteSnapshot = OriginalSnapshot<WorldEntry>
export type OriginalNotePatch = Partial<Pick<WorldFormData,
  'title' | 'summary' | 'cover' | 'gallery' | 'relations' | 'parentId' | 'document' | 'content'
>> & {
  graphPosition?: GraphPosition
  mapPosition?: GraphPosition | null
  mapId?: string | null
  mapImage?: string | null
  mapWidth?: number
  mapHeight?: number
  mapAnnotations?: string | null
  mapSeed?: number
  mapParams?: string
  mapMode?: string
}

function readNote(id: number, data: RecordValue, title: unknown): WorldEntry {
  const defaults = buildDefaultEntry(newWorldEntryData(), { createdAt: 0, updatedAt: 0, _lastModified: 0 })
  return {
    ...defaults,
    ...data,
    id,
    title: typeof data.title === 'string' ? data.title : typeof title === 'string' ? title : defaults.title,
    content: typeof data.content === 'string' ? data.content : defaults.content,
    category: typeof data.category === 'string' ? data.category : defaults.category,
    parentId: typeof data.parentId === 'number' ? data.parentId : null,
    relations: Array.isArray(data.relations)
      ? data.relations.filter(relation => relation && typeof relation.name === 'string' && typeof relation.relation === 'string')
      : defaults.relations,
    gallery: Array.isArray(data.gallery)
      ? data.gallery.filter(image => image && typeof image.url === 'string')
      : defaults.gallery,
  }
}

export class OriginalNotesCloudAdapter extends OriginalEntityCloudAdapter<WorldEntry, OriginalNotePatch> {
  constructor(workspaceId: string, fetcher: Fetcher = fetch) {
    super(workspaceId, 'worldEntry', readNote, entity => entity.title, fetcher)
  }
}

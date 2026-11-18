import type { Event, GraphPosition } from '@/types'
import type { EventFormData } from '@/features/events/types'
import { buildDefaultEvent } from '@/features/events/services'
import { newEventData } from '@/lib/entity-defaults'
import { OriginalEntityCloudAdapter, type Fetcher, type OriginalSnapshot, type RecordValue } from './original-entities'

export type OriginalEventSnapshot = OriginalSnapshot<Event>
export type OriginalEventPatch = Partial<Pick<EventFormData,
  'title' | 'time' | 'endTime' | 'location' | 'summary' | 'isMajor' | 'headerUrl' |
  'images' | 'characters' | 'countries' | 'relations' | 'document'
>> & { graphPosition?: GraphPosition; mapPosition?: GraphPosition | null; mapId?: string | null }

function readEvent(id: number, data: RecordValue, title: unknown): Event {
  const defaults = buildDefaultEvent(newEventData(), { createdAt: 0, updatedAt: 0, _lastModified: 0 })
  // Earlier generic cloud rows might store the title only in the entity envelope.
  return {
    ...defaults,
    ...data,
    id,
    title: typeof data.title === 'string' ? data.title : typeof title === 'string' ? title : defaults.title,
    time: typeof data.time === 'string' ? data.time : defaults.time,
    endTime: typeof data.endTime === 'string' ? data.endTime : undefined,
    location: typeof data.location === 'string' ? data.location : defaults.location,
    summary: typeof data.summary === 'string' ? data.summary : defaults.summary,
    content: typeof data.content === 'string' ? data.content : defaults.content,
    isMajor: typeof data.isMajor === 'boolean' ? data.isMajor : defaults.isMajor,
    characters: Array.isArray(data.characters) ? data.characters : defaults.characters,
    countries: Array.isArray(data.countries) ? data.countries : defaults.countries,
    relations: Array.isArray(data.relations)
      ? data.relations.filter(relation => relation && Number.isSafeInteger(relation.targetId) && typeof relation.relation === 'string')
      : defaults.relations,
    images: Array.isArray(data.images)
      ? data.images.filter(image => image && typeof image.url === 'string')
      : defaults.images,
    tags: Array.isArray(data.tags) ? data.tags : defaults.tags,
  }
}

export class OriginalEventsCloudAdapter extends OriginalEntityCloudAdapter<Event, OriginalEventPatch> {
  constructor(workspaceId: string, fetcher: Fetcher = fetch) {
    super(workspaceId, 'event', readEvent, entity => entity.title, fetcher)
  }
}

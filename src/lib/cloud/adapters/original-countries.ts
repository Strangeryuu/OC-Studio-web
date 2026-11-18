import type { Country, GraphPosition } from '@/types'
import type { CountryFormData } from '@/features/countries/types'
import { buildDefaultCountry } from '@/features/countries/services'
import { newCountryData } from '@/lib/entity-defaults'
import { OriginalEntityCloudAdapter, type Fetcher, type OriginalSnapshot, type RecordValue } from './original-entities'

export type OriginalCountrySnapshot = OriginalSnapshot<Country>
export type OriginalCountryPatch = Partial<Pick<CountryFormData, 'name' | 'description' | 'custom' | 'document' | 'flagUrl' | 'headerUrl' | 'gallery'>> & { graphPosition?: GraphPosition; mapPosition?: GraphPosition | null; mapId?: string | null }

function readCountry(id: number, data: RecordValue, title: unknown): Country {
  const defaults = buildDefaultCountry(newCountryData(), { createdAt: 0, updatedAt: 0, _lastModified: 0 })
  // Earlier generic cloud rows might store the title only in the entity envelope.
  return {
    ...defaults,
    ...data,
    id,
    name: typeof data.name === 'string' ? data.name : typeof title === 'string' ? title : defaults.name,
    description: typeof data.description === 'string' ? data.description : defaults.description,
    gallery: Array.isArray(data.gallery) ? data.gallery : defaults.gallery,
    tags: Array.isArray(data.tags) ? data.tags : defaults.tags,
  }
}

export class OriginalCountriesCloudAdapter extends OriginalEntityCloudAdapter<Country, OriginalCountryPatch> {
  constructor(workspaceId: string, fetcher: Fetcher = fetch) {
    super(workspaceId, 'country', readCountry, entity => entity.name, fetcher)
  }
}

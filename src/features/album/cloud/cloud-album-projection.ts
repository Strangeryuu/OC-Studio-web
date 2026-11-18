import type { Character, Country, Event, WorldEntry } from '@/types'
import type { AlbumEntry } from '@/components/shared/useAlbumData'
import { collectCharacterImageRefs, collectCountryImageRefs,
  collectEventImageRefs, collectWorldEntryImageRefs, type ImageRef } from '@/lib/image-refs'
import { cloudMediaUrlId } from '@/lib/cloud/character-media'
import { isCodexEntry } from '@/lib/entry-kinds'

/** The same original image collectors power the desktop album and backup. */
export interface CloudAlbumDataset {
  characters: readonly Character[]
  countries: readonly Country[]
  events: readonly Event[]
  notes: readonly WorldEntry[]
}

export function projectCloudAlbum(dataset: CloudAlbumDataset): AlbumEntry[] {
  const items: AlbumEntry[] = []
  const push = (row: { id: number; updatedAt?: number; tags?: number[] }, name: string,
    sourceType: string, images: ImageRef[]) => {
    for (const image of images) {
      // Cloud-owned media is served only after member authorization.
      if (!cloudMediaUrlId(image.url)) continue
      items.push({ url: image.url, sourceName: name, sourceType, sourceId: row.id,
        category: image.category, updatedAt: row.updatedAt ?? 0, tags: row.tags ?? [] })
    }
  }
  for (const row of dataset.characters) push(row, row.name, 'character', collectCharacterImageRefs(row))
  for (const row of dataset.countries) push(row, row.name, 'country', collectCountryImageRefs(row))
  for (const row of dataset.events) push(row, row.title, 'event', collectEventImageRefs(row))
  // Match desktop global-album rules: novels and maps are separate content categories.
  for (const row of dataset.notes) if (isCodexEntry(row)) {
    push(row, row.title, 'worldEntry', collectWorldEntryImageRefs(row))
  }
  return items
}

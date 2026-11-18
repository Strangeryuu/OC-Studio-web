import type { Character } from '@/types'
import type { CharacterFormData } from '@/features/characters/types'
import { CloudEntityError, OriginalEntityCloudAdapter, type Fetcher, type OriginalSnapshot, type RecordValue } from './original-entities'

export { CloudEntityError as CloudCharacterError }

export type OriginalCharacterPatch = Omit<Partial<CharacterFormData>, 'countryId'> & { countryId?: number | null }
export interface OriginalCharacterSnapshot extends Omit<OriginalSnapshot<Character>, 'entity'> {
  readonly character: Character
}

function readCharacter(id: number, data: RecordValue): Character {
  if (typeof data.name !== 'string' || typeof data.deleted !== 'boolean' ||
    typeof data.createdAt !== 'number' || typeof data.updatedAt !== 'number' ||
    !Array.isArray(data.aliases) || !Array.isArray(data.relatedCharacters) ||
    !Array.isArray(data.gallery) || !Array.isArray(data.avatars) || !Array.isArray(data.tags)) {
    throw new CloudEntityError('INVALID_CHARACTER_DATA', 500)
  }
  return { ...data, id, countryId: data.countryId ?? undefined } as unknown as Character
}

function characterSnapshot({ entity, ...snapshot }: OriginalSnapshot<Character>): OriginalCharacterSnapshot {
  return { ...snapshot, character: entity }
}

export class OriginalCharactersCloudAdapter {
  private readonly entities: OriginalEntityCloudAdapter<Character, OriginalCharacterPatch>

  constructor(readonly workspaceId: string, fetcher: Fetcher = fetch) {
    this.entities = new OriginalEntityCloudAdapter(workspaceId, 'character', readCharacter, fetcher)
  }

  async list(): Promise<OriginalCharacterSnapshot[]> {
    return (await this.entities.list()).map(characterSnapshot)
  }

  async create(character: Omit<Character, 'id'>): Promise<OriginalCharacterSnapshot> {
    return characterSnapshot(await this.entities.create(character))
  }

  async save({ character, ...snapshot }: OriginalCharacterSnapshot, patch: OriginalCharacterPatch): Promise<OriginalCharacterSnapshot> {
    return characterSnapshot(await this.entities.save({ ...snapshot, entity: character }, patch))
  }

  async remove({ character, ...snapshot }: OriginalCharacterSnapshot): Promise<void> {
    await this.entities.remove({ ...snapshot, entity: character })
  }
}

'use client'

import type { FieldDef } from '@/lib/fields/types'
import type { CloudCharacterFields } from '@/lib/cloud/character-document'

type CharacterTextField = 'race' | 'element' | 'occupation' | 'faction' | 'height' | 'birthday' | 'country'
const textFields = new Set<string>(['race', 'element', 'occupation', 'faction', 'height', 'birthday', 'country'])

export function CloudCharacterInfoFields({ fields, value, editable, onChange }: {
  fields: readonly FieldDef[]
  value: CloudCharacterFields
  editable: boolean
  onChange: (change: Partial<CloudCharacterFields>) => void
}) {
  return (
    <section className="rounded-lg border border-[var(--oc-line)] p-5">
      <h2 className="mb-4 text-lg font-semibold">角色基本信息</h2>
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          姓名
          <input value={value.name} disabled={!editable}
            onChange={event => onChange({ name: event.target.value })}
            maxLength={200}
            className="rounded-md border border-[var(--oc-line)] bg-transparent px-3 py-2 disabled:opacity-60" />
        </label>
        {fields.map(field => {
          if (field.id === 'isMajor') {
            return <label key={field.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={value.isMajor} disabled={!editable}
                onChange={event => onChange({ isMajor: event.target.checked })} />
              {field.label}
            </label>
          }
          if (field.id === 'aliases') {
            return <label key={field.id} className="flex flex-col gap-1 text-sm">
              {field.label}
              <input value={value.aliases.join('、')} disabled={!editable}
                onChange={event => onChange({
                  aliases: event.target.value.split(/[,，、]/).map(part => part.trim()).filter(Boolean),
                })}
                className="rounded-md border border-[var(--oc-line)] bg-transparent px-3 py-2 disabled:opacity-60" />
            </label>
          }
          if (textFields.has(field.id)) {
            const key = field.id as CharacterTextField
            return <label key={field.id} className="flex flex-col gap-1 text-sm">
              {field.label}
              <input value={value[key]} disabled={!editable}
                onChange={event => onChange({ [key]: event.target.value })}
                className="rounded-md border border-[var(--oc-line)] bg-transparent px-3 py-2 disabled:opacity-60" />
            </label>
          }
          if (field.key) {
            const key = field.key
            return <label key={field.id} className="flex flex-col gap-1 text-sm">
              {field.label}
              <input value={value.custom[key] ?? ''} disabled={!editable}
                onChange={event => onChange({
                  custom: { ...value.custom, [key]: event.target.value },
                })}
                className="rounded-md border border-[var(--oc-line)] bg-transparent px-3 py-2 disabled:opacity-60" />
            </label>
          }
          return null
        })}
      </div>
      <p className="text-xs opacity-60">字段名称、排序和可见性由本世界观的模板设置控制。隐藏字段的已有值继续保留。</p>
    </section>
  )
}

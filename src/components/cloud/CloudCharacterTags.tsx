'use client'

import { useState, type FormEvent } from 'react'
import { Plus, X } from 'lucide-react'

export function CloudCharacterTags({ tags, editable, onChange }: {
  tags: string[]
  editable: boolean
  onChange: (tags: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  function addTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editable) return
    const text = draft.trim()
    if (!text || text.length > 40 || tags.length >= 30 ||
        tags.some(tag => tag.toLocaleLowerCase('zh-CN') === text.toLocaleLowerCase('zh-CN'))) {
      setError('标签需在 1–40 个字符内，最多 30 个，且名称不可重复。')
      return
    }
    onChange([...tags, text])
    setDraft('')
    setError(null)
  }

  return <section className="rounded-lg border border-[var(--oc-line)] p-5">
    <h2 className="mb-4 text-lg font-semibold">角色标签</h2>
    <div className="flex flex-wrap gap-2">
      {tags.map(tag => <span key={tag}
        className="inline-flex items-center gap-2 rounded-full border border-[var(--oc-line)] px-3 py-1 text-sm">
        {tag}
        {editable && <button type="button" aria-label={'移除标签 ' + tag}
          onClick={() => onChange(tags.filter(value => value !== tag))}><X size={14}/></button>}
      </span>)}
      {tags.length === 0 && <p className="text-sm opacity-60">暂无标签</p>}
    </div>
    {editable && <form onSubmit={addTag} className="mt-4 flex flex-wrap gap-2">
      <input value={draft} maxLength={40} onChange={event => setDraft(event.target.value)}
        className="min-w-0 flex-1 rounded-md border border-[var(--oc-line)] bg-transparent px-3 py-2 text-sm"
        placeholder="例如：主角、战斗系" aria-label="新标签" />
      <button type="submit" className="inline-flex items-center gap-1 rounded-md border border-[var(--oc-line)] px-3 py-2 text-sm">
        <Plus size={15}/>添加标签
      </button>
    </form>}
    {error && <p role="alert" className="mt-2 text-sm">{error}</p>}
    <p className="mt-3 text-xs opacity-60">当前为保存在角色资料中的云端文字标签；全局标签库与跨角色筛选会在后续接入。</p>
  </section>
}

import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { shareImageUrl, shareMediaUrl, type SharedWorkspace } from '@/lib/cloud/server/public-share'

export interface SharedEntry {
  id: string
  local_id: string
  kind: string
  title: string
  content: Record<string, unknown>
  updated_at: string
}
type Selection = { section?: string; entry?: string; category?: string; q?: string }
type Section = 'home' | 'character' | 'country' | 'event' | 'world' |
  'novel' | 'map' | 'timeline' | 'relations' | 'album' | 'other'
const SECTIONS: { id: Section; title: string }[] = [
  { id: 'home', title: '主页' }, { id: 'character', title: '角色' },
  { id: 'country', title: '国家' }, { id: 'event', title: '事件' },
  { id: 'world', title: '世界观' }, { id: 'novel', title: '小说' },
  { id: 'map', title: '地图' }, { id: 'timeline', title: '时间线' },
  { id: 'relations', title: '关系图' }, { id: 'album', title: '全局相册' },
  { id: 'other', title: '其他资料' },
]
const KEYS: Record<string, string> = {
  aliases: '别名', race: '种族', element: '属性', occupation: '职业',
  faction: '阵营', height: '身高', birthday: '生日', bio: '简介',
  lifeStory: '人生经历', nationalityLegacy: '国籍', countryId: '所属国家',
  isMajor: '主要角色', system: '制度', geography: '地理', culture: '文化',
  location: '地点', time: '时间', endTime: '结束时间', summary: '概述',
  description: '描述', content: '内容', document: '正文', custom: '自定义字段',
  gallery: '画廊', avatars: '头像与立绘', images: '图片', tags: '标签',
  relatedCharacters: '相关角色', relatedNotes: '相关词条', relations: '关联关系',
  countries: '相关国家', characters: '参与角色', parentId: '上级条目',
  parentEventId: '上级事件', chapterOutline: '章节大纲',
  novelAuthor: '作者', novelSynopsis: '小说简介', novelNotes: '创作笔记',
  novelTargetWords: '目标字数', novelCover: '小说封面',
  order: '顺序', category: '分类', template: '模板',
  mapImage: '地图图像', mapViews: '地图视图', mapWidth: '地图宽度',
  mapHeight: '地图高度', mapMode: '地图模式',
  mapAnnotations: '地图标注', mapParams: '地图参数',
  mapSeed: '地图种子', mapId: '所属地图', references: '引用',
  cover: '封面', headerUrl: '头图', avatarUrl: '头像', flagUrl: '旗帜',
}
const INTERNAL = new Set([
  'id', 'name', 'title', 'deleted', '_syncStatus', '_lastModified',
  'createdAt', 'updatedAt', 'graphPosition', 'mapPosition',
  'avatarMediaId', 'headerMediaId', 'portraitMediaIds', 'galleryMediaIds',
])
const BOX = 'rounded-panel border border-[var(--oc-line)] p-4 sm:p-5'
const LINK = 'rounded-control border border-[var(--oc-line)] px-3 py-2 text-sm hover:bg-[var(--oc-hover)]'

function obj(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
function idNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null
  return value
}
function localId(row: SharedEntry): number | null {
  const id = Number(row.local_id)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
function sectionOf(row: SharedEntry): Section {
  if (row.kind === 'character' || row.kind === 'country' || row.kind === 'event')
    return row.kind
  if (row.kind === 'worldEntry') {
    if (row.content.category === '小说') return 'novel'
    if (row.content.category === '地图') return 'map'
    return 'world'
  }
  return 'other'
}
function pageLink(token: string, section: Section, entry?: string, category?: string): string {
  const params = new URLSearchParams({ section })
  if (entry) params.set('entry', entry)
  if (category) params.set('category', category)
  return '/share/' + token + '?' + params.toString()
}
function valueLink(token: string, row: SharedEntry) {
  return pageLink(token, sectionOf(row), row.id,
    sectionOf(row) === 'world' && typeof row.content.category === 'string'
      ? row.content.category : undefined)
}
function titleOf(key: string) {
  return KEYS[key] ?? key
}
function safeHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (/^https?:\/\/[^\s<>"']+$/i.test(value) || /^mailto:[^\s<>"']+$/i.test(value)) return value
  return undefined
}

function TipTapText({ node, token, depth = 0 }: { node: unknown; token: string; depth?: number }): ReactNode {
  if (!obj(node) || depth > 30) return null
  const children = Array.isArray(node.content)
    ? node.content.map((child, index) => <TipTapText key={index} node={child} token={token} depth={depth + 1} />)
    : null
  const attrs = obj(node.attrs) ? node.attrs : {}
  switch (node.type) {
    case 'text': {
      let result: ReactNode = str(node.text)
      if (Array.isArray(node.marks)) {
        for (const mark of node.marks) {
          if (!obj(mark)) continue
          if (mark.type === 'bold') result = <strong>{result}</strong>
          if (mark.type === 'italic') result = <em>{result}</em>
          if (mark.type === 'strike') result = <s>{result}</s>
          if (mark.type === 'code') result = <code>{result}</code>
          if (mark.type === 'underline') result = <u>{result}</u>
          if (mark.type === 'link') {
            const href = obj(mark.attrs) ? safeHref(mark.attrs.href) : undefined
            if (href) result = <a href={href} rel="noopener noreferrer" target="_blank" className="underline">{result}</a>
          }
        }
      }
      return result
    }
    case 'doc': return <div className="space-y-3">{children}</div>
    case 'paragraph': return <p className="whitespace-pre-wrap leading-relaxed">{children}</p>
    case 'heading': {
      const level = Number(attrs.level)
      if (level === 1) return <h2 className="text-xl font-semibold">{children}</h2>
      if (level === 2) return <h3 className="text-lg font-semibold">{children}</h3>
      return <h4 className="font-semibold">{children}</h4>
    }
    case 'bulletList': return <ul className="list-disc space-y-1 pl-6">{children}</ul>
    case 'orderedList': return <ol className="list-decimal space-y-1 pl-6">{children}</ol>
    case 'listItem': case 'taskItem': return <li>{children}</li>
    case 'blockquote': return <blockquote className="border-l-2 border-[var(--oc-line)] pl-4 italic">{children}</blockquote>
    case 'hardBreak': return <span className="block" />
    case 'horizontalRule': return <hr className="border-[var(--oc-line)]" />
    case 'codeBlock': return <pre className="overflow-x-auto rounded-control bg-[var(--oc-hover)] p-3 text-xs"><code>{children}</code></pre>
    case 'table': return <div className="overflow-x-auto"><table className="w-full border-collapse text-sm"><tbody>{children}</tbody></table></div>
    case 'tableRow': return <tr>{children}</tr>
    case 'tableHeader': return <th className="border border-[var(--oc-line)] p-2 text-left">{children}</th>
    case 'tableCell': return <td className="border border-[var(--oc-line)] p-2">{children}</td>
    case 'image': {
      const src = shareImageUrl(token, attrs.src)
      return src ? <figure className="my-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={str(attrs.alt)} loading="lazy" className="max-h-[600px] max-w-full rounded-control object-contain" />
        {typeof attrs.title === 'string' && <figcaption className="text-xs opacity-70">{attrs.title}</figcaption>}
      </figure> : null
    }
    default: return children ? <div>{children}</div> : null
  }
}
function LongText({ value, token }: { value: string; token: string }) {
  const rewritten = shareMediaUrl(token, value)
  return <div className="break-words text-sm leading-7 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_p]:mb-2 [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{rewritten}</ReactMarkdown>
  </div>
}
function AnyValue({ value, token, depth = 0 }: { value: unknown; token: string; depth?: number }): ReactNode {
  if (value === null || value === undefined || depth > 7) return null
  if (typeof value === 'boolean') return <span>{value ? '是' : '否'}</span>
  if (typeof value === 'number') return <span>{value}</span>
  if (typeof value === 'string') {
    if (!value.trim()) return <span className="opacity-60">暂无</span>
    const src = shareImageUrl(token, value)
    if (src) return <a href={src} target="_blank" rel="noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="世界观图片" loading="lazy" className="max-h-[400px] max-w-full rounded-control object-contain" />
    </a>
    if (value.length > 1000 && (value.startsWith('{') || value.startsWith('['))) {
      return <details><summary className="cursor-pointer text-sm">展开结构数据</summary>
        <pre className="max-h-[350px] overflow-auto whitespace-pre-wrap break-all text-xs">{value}</pre></details>
    }
    return <LongText value={value} token={token} />
  }
  if (Array.isArray(value)) {
    return value.length ? <ul className="flex flex-col gap-2">
      {value.map((item, index) => <li key={index} className="rounded-control border border-[var(--oc-line)] p-2">
        <AnyValue value={item} token={token} depth={depth + 1} />
      </li>)}
    </ul> : <span className="opacity-60">暂无</span>
  }
  if (obj(value) && value.type === 'doc') return <TipTapText node={value} token={token} />
  if (obj(value)) return <dl className="grid gap-2">
    {Object.entries(value).map(([key, item]) => <div key={key} className="text-sm">
      <dt className="text-xs opacity-60">{titleOf(key)}</dt>
      <dd className="mt-1 break-words"><AnyValue value={item} token={token} depth={depth + 1} /></dd>
    </div>)}
  </dl>
  return null
}
function EntryDetail({ token, entry, all }: { token: string; entry: SharedEntry; all: SharedEntry[] }) {
  const content = entry.content
  const hasDoc = obj(content.document) && content.document.type === 'doc'
  const imageKeys = ['avatarUrl','flagUrl','headerUrl','cover','novelCover','mapImage']
  const cover = imageKeys.map(key => shareImageUrl(token, content[key])).find(Boolean)
  const pairs = Object.entries(content).filter(([key, val]) =>
    !INTERNAL.has(key) && val !== null && val !== undefined && val !== '' &&
    !imageKeys.includes(key) && !(key === 'content' && hasDoc))
  return <article className={BOX + ' min-w-0 space-y-5'}>
    <div>
      <div className="text-xs text-ink-muted">{sectionTitle(sectionOf(entry))}
        {typeof content.category === 'string' ? ' · ' + content.category : ''}</div>
      <h2 className="mt-1 break-words text-2xl font-semibold">{entry.title}</h2>
    </div>
    {cover && <figure>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={cover} alt={entry.title} loading="lazy" className="max-h-[430px] w-full rounded-control object-contain" />
    </figure>}
    {sectionOf(entry) === 'map' && <MapPins token={token} map={entry} entries={all} />}
    <dl className="space-y-5">
      {pairs.map(([key, val]) => <div key={key} className="min-w-0 border-t border-[var(--oc-line)] pt-4">
        <dt className="mb-2 text-sm font-semibold">{titleOf(key)}</dt>
        <dd className="min-w-0 break-words"><AnyValue value={val} token={token} /></dd>
      </div>)}
    </dl>
  </article>
}
function sectionTitle(section: Section) {
  return SECTIONS.find(item => item.id === section)?.title ?? '其他资料'
}
function MapPins({ token, map, entries }: { token: string; map: SharedEntry; entries: SharedEntry[] }) {
  const src = shareImageUrl(token, map.content.mapImage)
  if (!src) return null
  const pins = entries.filter(row => row.kind === 'country' || row.kind === 'event' || row.kind === 'worldEntry')
    .filter(row => row.content.mapId === map.title && obj(row.content.mapPosition))
    .flatMap(row => {
      const p = row.content.mapPosition as Record<string, unknown>
      return typeof p.x === 'number' && typeof p.y === 'number' &&
        p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? [{ row, x: p.x, y: p.y }] : []
    })
  const width = Number(map.content.mapWidth)
  const height = Number(map.content.mapHeight)
  const ratio = width > 0 && height > 0 ? Math.max(0.2, Math.min(5, width / height)) : 16 / 9
  return <div className="space-y-2">
    <h3 className="font-semibold">地图锚点（只读）</h3>
    <div className="relative w-full overflow-hidden rounded-control" style={{ aspectRatio: String(ratio) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={map.title + '地图'} className="absolute inset-0 h-full w-full object-fill" />
      {pins.map(pin => <a key={pin.row.id} href={valueLink(token, pin.row)}
        title={pin.row.title} aria-label={'查看' + pin.row.title}
        style={{ position: 'absolute', left: pin.x * 100 + '%', top: pin.y * 100 + '%',
          transform: 'translate(-50%, -50%)' }}
        className="rounded-full border border-[var(--oc-line)] bg-[var(--oc-paper)] px-1.5 py-1 text-xs shadow">
        ●<span className="hidden sm:inline"> {pin.row.title.slice(0, 8)}</span>
      </a>)}
    </div>
  </div>
}
function collectAlbum(entries: SharedEntry[], cover: string, token: string) {
  const found = new Map<string, string>()
  function visit(value: unknown, title: string, depth: number) {
    if (depth > 12 || found.size > 1500) return
    if (typeof value === 'string') {
      const matches = value.match(/\/api\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi) ?? []
      for (const source of matches) {
        const url = shareImageUrl(token, source)
        if (url && !found.has(url)) found.set(url, title)
      }
      if (/^https:\/\/[^\s<>"']+\.(png|jpg|jpeg|webp|gif)(\?.*)?$/i.test(value)) {
        if (!found.has(value)) found.set(value, title)
      }
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, title, depth + 1)
    } else if (obj(value)) {
      for (const item of Object.values(value)) visit(item, title, depth + 1)
    }
  }
  visit(cover, '世界封面', 0)
  for (const entry of entries) visit(entry.content, entry.title, 0)
  return [...found.entries()].map(([url, title]) => ({ url, title }))
}
function RelationshipDiagram({ token, entries }: { token: string; entries: SharedEntry[] }) {
  const available = entries.filter(row => ['character','country','event','worldEntry'].includes(row.kind) &&
    sectionOf(row) !== 'novel' && sectionOf(row) !== 'map')
  const nodes = available.slice(0, 120)
  const byKey = new Map(nodes.map(row => [row.kind + ':' + row.local_id, row]))
  const get = (kind: string, id: unknown) => idNumber(id) !== null ? byKey.get(kind + ':' + id) : undefined
  const edges: { from: string; to: string; label: string }[] = []
  const used = new Set<string>()
  const edge = (from: SharedEntry, to: SharedEntry | undefined, label: string) => {
    if (!to) return
    const key = from.id + ':' + to.id + ':' + label
    if (used.has(key)) return
    used.add(key)
    edges.push({ from: from.id, to: to.id, label })
  }
  for (const row of nodes) {
    const d = row.content
    if (row.kind === 'character') {
      edge(row, get('country', d.countryId), '所属')
      if (Array.isArray(d.relatedCharacters)) for (const item of d.relatedCharacters) if (obj(item))
        edge(row, get('character', item.characterId), str(item.relation) || '关系')
      if (Array.isArray(d.relatedNotes)) for (const item of d.relatedNotes) if (obj(item))
        edge(row, get('worldEntry', item.targetId), str(item.relation) || '相关')
    }
    if (row.kind === 'event') {
      if (Array.isArray(d.characters)) for (const id of d.characters) edge(row, get('character', id), '参与')
      if (Array.isArray(d.countries)) for (const id of d.countries) edge(row, get('country', id), '涉及')
      if (Array.isArray(d.relations)) for (const item of d.relations) if (obj(item))
        edge(row, get('event', item.targetId), str(item.relation) || '相关')
    }
    if (row.kind === 'worldEntry' && Array.isArray(d.relations)) {
      for (const item of d.relations) if (obj(item))
        edge(row, get('worldEntry', item.targetId), str(item.relation) || '相关')
    }
  }
  const columns = 4
  const positions = new Map(nodes.map((row, index) => [row.id, {
    x: 105 + (index % columns) * 218,
    y: 56 + Math.floor(index / columns) * 125,
  }]))
  const width = columns * 218
  const height = Math.max(150, Math.ceil(nodes.length / columns) * 125)
  return <div className={BOX + ' space-y-3'}>
    <h2 className="text-xl font-semibold">关系图（只读）</h2>
    <p className="text-xs opacity-70">展示 {nodes.length} 个节点、{edges.length} 条关系。点击节点可阅读详细内容，访客可以浏览但无法拖动或修改连线。</p>
    {available.length > nodes.length && <p className="text-xs">关系图优先展示前 120 个节点，其余条目可通过分类列表继续浏览。</p>}
    <div className="max-h-[800px] overflow-auto rounded-control border border-[var(--oc-line)]">
      <svg viewBox={'0 0 ' + width + ' ' + height} width={width} height={height}
        role="img" aria-label="世界观关系图，仅浏览">
        {edges.map((link, index) => {
          const from = positions.get(link.from), to = positions.get(link.to)
          if (!from || !to) return null
          return <g key={index}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke="currentColor" opacity="0.23" strokeWidth="1.5" />
            <title>{link.label}</title>
          </g>
        })}
        {nodes.map(row => {
          const pos = positions.get(row.id)!
          return <a key={row.id} href={valueLink(token, row)} aria-label={'查看' + row.title}>
            <rect x={pos.x - 90} y={pos.y - 22} width="180" height="46"
              rx="12" fill="var(--oc-paper)" stroke="var(--oc-line)" strokeWidth="1.5" />
            <text x={pos.x} y={pos.y + 4} fontSize="13" fill="var(--oc-ink)"
              textAnchor="middle">{row.title.slice(0, 14)}</text>
          </a>
        })}
      </svg>
    </div>
    {edges.length > 0 && <details>
      <summary className="cursor-pointer text-sm">查看关系文字列表</summary>
      <ul className="mt-2 space-y-1 text-sm">
        {edges.map((link, index) => <li key={index}>{nodes.find(row => row.id === link.from)?.title}
          {' — ' + link.label + ' — '}{nodes.find(row => row.id === link.to)?.title}</li>)}
      </ul>
    </details>}
  </div>
}

export function PublicWorkspaceViewer({ token, workspace, entries, cover, categories, selection }: {
  token: string
  workspace: SharedWorkspace
  entries: SharedEntry[]
  cover: string
  categories: string[]
  selection: Selection
}) {
  const requestedSection = selection.section
  const section = SECTIONS.some(item => item.id === requestedSection)
    ? requestedSection as Section : 'home'
  const category = section === 'world' && typeof selection.category === 'string'
    ? selection.category.slice(0, 100) : ''
  const q = typeof selection.q === 'string' ? selection.q.trim().slice(0, 100) : ''
  const rows = entries.filter(row => sectionOf(row) === section &&
    (!category || row.content.category === category) &&
    (!q || (row.title + ' ' + JSON.stringify(row.content)).toLocaleLowerCase().includes(q.toLocaleLowerCase())))
  const selected = rows.find(row => row.id === selection.entry) ?? null
  const count = (id: Section) => entries.filter(row => sectionOf(row) === id).length
  const worldCategories = [...new Set([
    ...categories,
    ...entries.filter(row => sectionOf(row) === 'world').map(row => str(row.content.category)).filter(Boolean),
  ])]
  const coverSrc = shareImageUrl(token, cover)
  const imageRows = section === 'album' ? collectAlbum(entries, cover, token) : []
  const timeline = section === 'timeline' ? entries.filter(row => row.kind === 'event')
    .sort((a, b) => str(a.content.time).localeCompare(str(b.content.time), 'zh-CN')) : []
  return <div className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
    <header className="sticky top-0 z-10 -mx-4 border-b border-[var(--oc-line)] bg-[var(--oc-paper)] px-4 py-3 sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a href={pageLink(token, 'home')} className="font-semibold">OC Studio · 世界观分享</a>
        <span className="rounded-control border border-[var(--oc-line)] px-3 py-1 text-xs">游客只读 · 无需注册</span>
      </div>
    </header>
    <div className="py-6">
      {section === 'home' && coverSrc && <div className="mb-5 h-40 overflow-hidden rounded-panel sm:h-64">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={coverSrc} alt={workspace.name + '封面'} className="h-full w-full object-cover" />
      </div>}
      <h1 className="text-2xl font-semibold sm:text-3xl">{workspace.name}</h1>
      {workspace.description && <p className="mt-2 whitespace-pre-wrap text-sm opacity-70">{workspace.description}</p>}
    </div>
    <div className="grid gap-6 md:grid-cols-[210px_minmax(0,1fr)]">
      <nav aria-label="访客只读导航" className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
        {SECTIONS.map(item => <a key={item.id} href={pageLink(token, item.id)}
          aria-current={section === item.id ? 'page' : undefined}
          className={LINK + ' shrink-0 ' + (section === item.id ? 'font-semibold bg-[var(--oc-hover)]' : '')}>
          {item.title}{['character','country','event','world','novel','map','other'].includes(item.id) &&
            <span className="ml-1 text-xs opacity-60">{count(item.id)}</span>}
        </a>)}
      </nav>
      <main className="min-w-0 space-y-5">
        {section === 'home' && <div className={BOX + ' space-y-4'}>
          <h2 className="text-xl font-semibold">世界观概览</h2>
          <p className="text-sm opacity-70">欢迎阅读这个世界观。所有展示内容均为只读，点击分类或条目即可浏览详细设定。</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {SECTIONS.filter(item => ['character','country','event','world','novel','map'].includes(item.id))
              .map(item => <a key={item.id} href={pageLink(token, item.id)}
                className="rounded-control border border-[var(--oc-line)] p-4 hover:bg-[var(--oc-hover)]">
                <div className="text-xs opacity-70">{item.title}</div>
                <div className="mt-2 text-2xl font-semibold">{count(item.id)}</div>
              </a>)}
          </div>
          <h3 className="font-semibold">最近更新</h3>
          <ul className="space-y-2">
            {[...entries].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 12).map(row =>
              <li key={row.id}><a className="block rounded-control border border-[var(--oc-line)] p-3 hover:bg-[var(--oc-hover)]"
                href={valueLink(token, row)}>{row.title} <span className="text-xs opacity-60">{sectionTitle(sectionOf(row))}</span></a></li>)}
          </ul>
        </div>}
        {['character','country','event','world','novel','map','other'].includes(section) && <>
          <h2 className="text-xl font-semibold">{sectionTitle(section)}</h2>
          {section === 'world' && worldCategories.length > 0 && <div className="flex flex-wrap gap-2">
            <a href={pageLink(token, 'world')} className={LINK + (!category ? ' font-semibold' : '')}>全部词条</a>
            {worldCategories.map(name => <a key={name} href={pageLink(token, 'world', undefined, name)}
              className={LINK + (category === name ? ' font-semibold' : '')}>{name}</a>)}
          </div>}
          <form method="get" action={'/share/' + token} className="flex flex-wrap gap-2">
            <input type="hidden" name="section" value={section} />
            {category && <input type="hidden" name="category" value={category} />}
            <input type="search" name="q" maxLength={100} defaultValue={q} placeholder="搜索标题或内容"
              className="min-w-0 flex-1 rounded-control border border-[var(--oc-line)] bg-transparent px-3 py-2 text-sm" />
            <button type="submit" className={LINK}>搜索</button>
          </form>
          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="max-h-[680px] space-y-1 overflow-y-auto rounded-panel border border-[var(--oc-line)] p-2">
              {rows.map(row => <a key={row.id} href={valueLink(token, row)}
                aria-current={selected?.id === row.id ? 'page' : undefined}
                className={'block break-words rounded-control px-3 py-2 text-sm hover:bg-[var(--oc-hover)]' +
                  (selected?.id === row.id ? ' bg-[var(--oc-hover)] font-semibold' : '')}>{row.title}</a>)}
              {rows.length === 0 && <p className="p-3 text-sm opacity-60">此分类暂无内容</p>}
            </div>
            {selected ? <EntryDetail token={token} entry={selected} all={entries} /> :
              <div className={BOX + ' text-sm opacity-70'}>请选择左侧条目查看完整内容。</div>}
          </div>
        </>}
        {section === 'timeline' && <div className={BOX + ' space-y-3'}>
          <h2 className="text-xl font-semibold">事件时间线（只读）</h2>
          {timeline.map(row => <a key={row.id} href={valueLink(token, row)}
            className="block border-l-2 border-[var(--oc-line)] py-2 pl-4 hover:bg-[var(--oc-hover)]">
            <time className="text-xs opacity-70">{str(row.content.time) || '未设置时间'}
              {row.content.endTime ? ' — ' + str(row.content.endTime) : ''}</time>
            <div className="font-medium">{row.title}</div>
            {typeof row.content.summary === 'string' && <p className="mt-1 line-clamp-3 text-sm opacity-70">{row.content.summary}</p>}
          </a>)}
          {timeline.length === 0 && <p className="text-sm opacity-70">暂无事件</p>}
        </div>}
        {section === 'relations' && <RelationshipDiagram token={token} entries={entries} />}
        {section === 'album' && <div className={BOX + ' space-y-4'}>
          <h2 className="text-xl font-semibold">世界观相册（只读）</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {imageRows.map(image => <a key={image.url} href={image.url} target="_blank" rel="noreferrer"
              className="overflow-hidden rounded-control border border-[var(--oc-line)] hover:opacity-85">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt={image.title} loading="lazy" className="h-36 w-full object-cover sm:h-44" />
              <div className="truncate p-2 text-xs">{image.title}</div>
            </a>)}
          </div>
          {imageRows.length === 0 && <p className="text-sm opacity-70">暂无图片</p>}
        </div>}
        <p className="pt-4 text-xs opacity-60">公开分享仅授予浏览权限。创建、编辑、删除、上传、管理成员及导出备份等操作均需要原工作台授权。</p>
      </main>
    </div>
  </div>
}

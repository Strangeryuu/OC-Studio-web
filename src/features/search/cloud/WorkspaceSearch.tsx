'use client'
import { useEffect, useState } from 'react'
import { Search, BookText, CalendarDays, Users, Flag, BookOpen, Map } from 'lucide-react'
import { splitHighlight, searchTerms } from '@/lib/search/matcher'
import type { CloudSearchHit } from '@/lib/cloud/workspace-search'
import { FIELD_INPUT } from '@/lib/ui-tokens'
const LABEL={character:'角色',country:'国家',event:'事件',world:'世界观',novel:'小说',map:'地图'} as const
export function WorkspaceSearch({workspaceId,onOpen}:{
  workspaceId:string;onOpen:(result:CloudSearchHit)=>void
}){
  const [query,setQuery]=useState('')
  const [hits,setHits]=useState<CloudSearchHit[]>([])
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const [truncated,setTruncated]=useState(false)
  useEffect(()=>{
    const keyword=query.trim()
    if(!keyword){setHits([]);setError(null);setTruncated(false);setLoading(false);return}
    const ctrl=new AbortController()
    setLoading(true)
    const timer=window.setTimeout(()=>{
      void fetch('/api/workspaces/'+workspaceId+'/search?q='+encodeURIComponent(keyword),
        {cache:'no-store',signal:ctrl.signal})
        .then(async response=>{
          const result:{hits?:CloudSearchHit[];truncated?:boolean;error?:string}=await response.json()
          if(!response.ok||!Array.isArray(result.hits))throw new Error(result.error??'搜索失败')
          return result
        })
        .then(result=>{if(ctrl.signal.aborted)return;setHits(result.hits!);setTruncated(Boolean(result.truncated));setError(null)})
        .catch(cause=>{if(!ctrl.signal.aborted)setError(cause instanceof Error?cause.message:'搜索失败')})
        .finally(()=>{if(!ctrl.signal.aborted)setLoading(false)})
    },250)
    return ()=>{window.clearTimeout(timer);ctrl.abort()}
  },[query,workspaceId])
  const terms=searchTerms(query)
  function highlight(label:string){
    return splitHighlight(label,terms).map((chunk,i)=>chunk.hit?
      <strong key={i} className="font-semibold text-ink">{chunk.text}</strong>:
      <span key={i}>{chunk.text}</span>)
  }
  function Icon({kind}:{kind:CloudSearchHit['kind']}){
    if(kind==='character')return <Users size={17}/>
    if(kind==='country')return <Flag size={17}/>
    if(kind==='event')return <CalendarDays size={17}/>
    if(kind==='novel')return <BookText size={17}/>
    if(kind==='map')return <Map size={17}/>
    return <BookOpen size={17}/>
  }
  return <section className="min-w-0 border-t border-line pt-4">
    <div className="mb-3">
      <h2 className="text-reading font-semibold">全局搜索</h2>
      <p className="text-caption text-ink-muted">搜索当前世界观的角色、国家、事件、笔记、分类词条、小说章节及地图。多个关键词需全部命中。</p>
    </div>
    <label className="flex items-center gap-2 rounded-control border border-line px-3 py-2">
      <Search size={18}/>
      <input autoFocus className={FIELD_INPUT+' min-w-0 flex-1 border-0 bg-transparent'}
        aria-label="搜索世界观" placeholder="搜索名称、别名、字段或正文…"
        value={query} maxLength={120} onChange={event=>setQuery(event.target.value)} />
    </label>
    {loading&&<p className="mt-2 text-caption text-ink-faint">搜索中…</p>}
    {error&&<p role="alert" className="mt-2 text-ui text-error">{error}</p>}
    {!loading&&query.trim()&&hits.length===0&&!error&&
      <p className="rounded-panel border border-dashed border-line p-8 text-center text-ui text-ink-muted">没有匹配结果</p>}
    {truncated&&<p className="mt-2 text-caption text-ink-muted">结果较多，已显示最相关的前 80 条。可增加关键词缩小范围。</p>}
    <ul className="mt-3 divide-y divide-line">
      {hits.map(result=><li key={result.entityId}>
        <button type="button" className="flex w-full items-start gap-3 rounded-item px-3 py-3 text-left text-ui hover:bg-[var(--oc-hover)]"
          onClick={()=>onOpen(result)}>
          <span className="mt-0.5 text-ink-faint"><Icon kind={result.kind}/></span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{highlight(result.title)}</span>
              <span className="text-caption text-ink-faint">{LABEL[result.kind]}{result.category&&result.kind==='world'?' · '+result.category:''}</span>
            </span>
            {result.snippet&&<span className="mt-1 block line-clamp-2 text-caption text-ink-muted">
              {highlight(result.snippet)}</span>}
          </span>
        </button>
      </li>)}
    </ul>
  </section>
}

'use client'
import { createElement, useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, RefreshCw } from 'lucide-react'
import { SortableList, DragHandle, useSortableItem, moveId } from '@/components/shared/list-dnd'
import { categoryIconOf, CATEGORY_ICON_LABELS, CATEGORY_ICON_NAMES } from '@/lib/categories/icons'
import { newCategoryId, type Category } from '@/lib/categories/types'
import { blankTemplateDoc } from '@/lib/templates/defaults'
import { TEMPLATE_COMPONENTS } from '@/lib/templates/registry'
import { TEMPLATE_PARAM_SCHEMA } from '@/lib/templates/params'
import { isNoteTemplate } from '@/lib/templates/note'
import type { TemplateDoc, TemplateComponent } from '@/lib/templates/types'
import { defaultWorkspaceCustomization, type WorkspaceCustomization } from '@/lib/cloud/workspace-customization'
import { BTN_PRIMARY, BTN_QUIET, FIELD_INPUT } from '@/lib/ui-tokens'

type Tab='categories'|'templates'
function CategoryLine({item,canEdit,templates,onEdit,onRemove,onToggle}:{
  item:Category;canEdit:boolean;templates:TemplateDoc[]
  onEdit:(c:Category)=>void;onRemove:(id:string)=>void;onToggle:(id:string)=>void
}){
  const sort=useSortableItem(item.id,!canEdit)
  return <li ref={sort.setNodeRef} style={sort.style}
    className="flex flex-wrap items-center gap-2 border-b border-line py-2 text-ui">
    {canEdit&&<DragHandle handleProps={{attributes:sort.attributes,listeners:sort.listeners}}/>}
    {createElement(categoryIconOf(item.icon),{size:16})}
    <span className="min-w-0 flex-1 truncate">{item.name}
      {item.builtin&&<span className="ml-1 text-caption text-ink-faint">内置</span>}
    </span>
    <span className="text-caption text-ink-faint">{templates.find(t=>t.id===item.template)?.name??item.template}</span>
    {canEdit&&<>
      <button type="button" className={BTN_QUIET} onClick={()=>onToggle(item.id)}>
        {item.enabled?'已启用':'已隐藏'}</button>
      {!item.builtin&&<>
        <button type="button" className={BTN_QUIET} onClick={()=>onEdit(item)}>编辑</button>
        <button type="button" aria-label={'删除分类'+item.name} className={BTN_QUIET}
          onClick={()=>onRemove(item.id)}><Trash2 size={14}/></button>
      </>}
    </>}
  </li>
}
function ComponentLine({item,canEdit,onToggle,onParams}:{
  item:TemplateComponent;canEdit:boolean;
  onToggle:(id:TemplateComponent['id'])=>void;onParams:(id:TemplateComponent['id'],key:string,value:string|number|boolean)=>void
}){
  const sort=useSortableItem(item.id,!canEdit)
  const params=TEMPLATE_PARAM_SCHEMA[item.id]??[]
  const choices=params.filter(def=>def.kind==='choice'&&def.options.length>0)
  return <li ref={sort.setNodeRef} style={sort.style}
    className="flex flex-wrap items-center gap-2 border-b border-line py-2 text-ui">
    {canEdit&&<DragHandle handleProps={{attributes:sort.attributes,listeners:sort.listeners}}/>}
    <span className="min-w-0 flex-1">{TEMPLATE_COMPONENTS.find(meta=>meta.id===item.id)?.label??item.id}</span>
    <label className="flex items-center gap-1">
      <input type="checkbox" checked={item.enabled} disabled={!canEdit} onChange={()=>onToggle(item.id)}/>启用
    </label>
    {canEdit&&choices.map(def=><label key={def.key} className="flex items-center gap-1">
      {def.label}
      <select className={FIELD_INPUT} value={String(item.params?.[def.key]??def.fallback)}
        onChange={event=>{
          const next=def.options.find(option=>String(option.value)===event.target.value)
          if(next)onParams(item.id,def.key,next.value)
        }}>
        {def.options.map(option=><option key={String(option.value)}
          value={String(option.value)}>{option.label}</option>)}
      </select>
    </label>)}
  </li>
}

export function WorkspaceCustomizationPanel({workspaceId,canManage,onSaved}:{
  workspaceId:string;canManage:boolean;onSaved?:()=>void
}){
  const [tab,setTab]=useState<Tab>('categories')
  const [data,setData]=useState<WorkspaceCustomization>(defaultWorkspaceCustomization)
  const [version,setVersion]=useState(0)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const [editCategory,setEditCategory]=useState<Category|null>(null)
  const [activeTemplate,setActiveTemplate]=useState<string>('entry')
  const load=useCallback(async()=>{
    setLoading(true);setError(null)
    try{
      const response=await fetch('/api/workspaces/'+workspaceId+'/customization',{cache:'no-store'})
      const result:{customization?:WorkspaceCustomization;version?:number;error?:string}=await response.json()
      if(!response.ok||!result.customization||typeof result.version!=='number')
        throw new Error(result.error??'模板和分类读取失败')
      setData(result.customization);setVersion(result.version)
    }catch(cause){setError(cause instanceof Error?cause.message:'读取失败')}
    finally{setLoading(false)}
  },[workspaceId])
  useEffect(()=>{void load()},[load])
  const save=useCallback(async(next:WorkspaceCustomization)=>{
    if(!canManage||busy)return
    setBusy(true);setError(null)
    try{
      const response=await fetch('/api/workspaces/'+workspaceId+'/customization',{
        method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({expectedVersion:version,customization:next}),
      })
      const result:{customization?:WorkspaceCustomization;version?:number;error?:string}=await response.json().catch(()=>({}))
      if(!response.ok||!result.customization||typeof result.version!=='number')
        throw new Error(result.error==='VERSION_CONFLICT'?'其他成员已更新配置，请刷新后重试':
          result.error??'保存失败')
      setData(result.customization);setVersion(result.version);onSaved?.()
    }catch(cause){setError(cause instanceof Error?cause.message:'保存失败')}
    finally{setBusy(false)}
  },[canManage,busy,version,workspaceId,onSaved])
  const updateCategories=(items:Category[])=>void save({...data,categories:items})
  const updateTemplates=(items:TemplateDoc[])=>void save({...data,templates:items})
  const ordered=useMemo(()=>[...data.categories].sort((a,b)=>a.order-b.order),[data.categories])
  const template=data.templates.find(item=>item.id===activeTemplate)??data.templates[0]
  const noteTemplates=data.templates.filter(isNoteTemplate)
  function toggleCategory(id:string){
    updateCategories(data.categories.map(item=>item.id===id?{...item,enabled:!item.enabled}:item))
  }
  function saveCategory(){
    if(!editCategory)return
    const exists=data.categories.some(item=>item.id===editCategory.id)
    const items=exists?data.categories.map(item=>item.id===editCategory.id?editCategory:item):
      [...data.categories,editCategory]
    updateCategories(items)
    setEditCategory(null)
  }
  function changeTemplate(patch:Partial<TemplateDoc>){
    if(!template)return
    const updated={...template,...patch}
    // Original template names remain valid for existing entries via aliases.
    if(patch.name&&patch.name!==template.name)
      updated.aliases=[...new Set([...template.aliases,template.name])]
    updateTemplates(data.templates.map(item=>item.id===template.id?updated:item))
  }
  return <section className="min-w-0 border-t border-line pt-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-reading font-semibold">模板与自定义分类</h2>
        <p className="text-caption text-ink-muted">原版模板组件与分类顺序保存在当前世界观资料库。{canManage?'仅管理员可调整。':'当前为只读视图。'}</p>
      </div>
      <button type="button" className={BTN_QUIET} disabled={loading||busy} onClick={()=>void load()}>
        <RefreshCw size={14}/>刷新</button>
    </div>
    <div className="mt-3 flex gap-2 border-b border-line pb-2">
      <button type="button" className={tab==='categories'?BTN_PRIMARY:BTN_QUIET}
        onClick={()=>setTab('categories')}>自定义分类</button>
      <button type="button" className={tab==='templates'?BTN_PRIMARY:BTN_QUIET}
        onClick={()=>setTab('templates')}>模板与组件</button>
    </div>
    {error&&<p role="alert" className="my-3 text-ui text-error">{error}</p>}
    {loading?<p className="p-6 text-ui text-ink-muted">正在加载…</p>:tab==='categories'?<>
      <SortableList ids={ordered.map(item=>item.id)} disabled={!canManage||busy} layout="list"
        onReorder={(from,to)=>{
          const ids=moveId(ordered.map(item=>item.id),String(from),String(to))
          const byId=new Map(data.categories.map(item=>[item.id,item]))
          updateCategories(ids.map((id,index)=>({...byId.get(id)!,order:index})))
        }}>
        <ul>{ordered.map(item=><CategoryLine key={item.id} item={item} templates={data.templates}
          canEdit={canManage&&!busy} onEdit={setEditCategory}
          onToggle={toggleCategory} onRemove={id=>{
            if(window.confirm('移除分类后，原有词条仍保留在世界观目录。确定删除？'))
              updateCategories(data.categories.filter(item=>item.id!==id))
          }}/>)}</ul>
      </SortableList>
      {canManage&&<button type="button" className={BTN_PRIMARY} disabled={busy}
        onClick={()=>setEditCategory({id:newCategoryId(),name:'新分类',
          template:'entry',icon:'book',order:ordered.length,enabled:true})}>
        <Plus size={14}/>新增分类</button>}
      {editCategory&&<div className="mt-4 grid gap-3 rounded-panel border border-line p-4">
        <label className="text-ui">分类名称
          <input className={FIELD_INPUT} aria-label="分类名称" value={editCategory.name}
            onChange={event=>setEditCategory({...editCategory,name:event.target.value})}/></label>
        <label className="text-ui">图标
          <select className={FIELD_INPUT} aria-label="分类图标" value={editCategory.icon}
            onChange={event=>setEditCategory({...editCategory,icon:event.target.value as Category['icon']})}>
            {CATEGORY_ICON_NAMES.map(icon=><option key={icon} value={icon}>{CATEGORY_ICON_LABELS[icon]}</option>)}
          </select></label>
        <label className="text-ui">绑定模板
          <select className={FIELD_INPUT} aria-label="分类绑定模板" value={editCategory.template}
            onChange={event=>setEditCategory({...editCategory,template:event.target.value})}>
            {noteTemplates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select></label>
        <div className="flex gap-2"><button type="button" className={BTN_PRIMARY}
          onClick={saveCategory} disabled={busy}>保存分类</button>
          <button type="button" className={BTN_QUIET} onClick={()=>setEditCategory(null)}>取消</button></div>
      </div>}
    </>:<>
      <div className="my-3 flex flex-wrap items-center gap-2">
        <label className="text-ui">模板
          <select className={FIELD_INPUT} aria-label="选择模板" value={template?.id??''}
            onChange={event=>setActiveTemplate(event.target.value)}>
            {data.templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select></label>
        {canManage&&<button type="button" className={BTN_QUIET} disabled={busy}
          onClick={()=>{
            const added=blankTemplateDoc(data.templates.map(t=>t.name))
            setActiveTemplate(added.id)
            updateTemplates([...data.templates,added])
          }}><Plus size={14}/>新建模板</button>}
        {canManage&&template?.id.startsWith('custom-')&&<button type="button" className={BTN_QUIET}
          disabled={busy} onClick={()=>{
            if(window.confirm('删除自建模板？已绑定它的分类须先改用其他模板。')){
              updateTemplates(data.templates.filter(item=>item.id!==template.id));setActiveTemplate('entry')
            }
          }}><Trash2 size={14}/>删除模板</button>}
      </div>
      {template&&<div className="space-y-3">
        <label className="block text-ui">模板名称
          <input className={FIELD_INPUT} disabled={!canManage||busy} aria-label="模板名称"
            value={template.name} onChange={event=>changeTemplate({name:event.target.value})}/>
        </label>
        <p className="text-caption text-ink-faint">模板组件顺序和显示状态来自原版；更改将同步到当前世界观。</p>
        <SortableList ids={template.components.map(item=>item.id)} layout="list" disabled={!canManage||busy}
          onReorder={(from,to)=>{
            const ids=moveId(template.components.map(c=>c.id),String(from),String(to))
            changeTemplate({components:ids.map(id=>template.components.find(c=>c.id===id)!)})
          }}>
          <ul>{template.components.map(component=><ComponentLine key={component.id} item={component}
            canEdit={canManage&&!busy}
            onToggle={id=>changeTemplate({components:template.components.map(c=>
              c.id===id?{...c,enabled:!c.enabled}:c)})}
            onParams={(id,key,value)=>changeTemplate({components:template.components.map(c=>
              c.id===id?{...c,params:{...c.params,[key]:value}}:c)})}/>)}</ul>
        </SortableList>
        {canManage&&<label className="flex items-center gap-2 text-ui">添加组件
          <select className={FIELD_INPUT} value="" onChange={event=>{
            const componentId=event.target.value as TemplateComponent['id']
            if(componentId)changeTemplate({components:[...template.components,{id:componentId,enabled:true}]})
          }}><option value="">请选择…</option>
            {TEMPLATE_COMPONENTS.filter(meta=>!template.components.some(c=>c.id===meta.id))
              .map(meta=><option key={meta.id} value={meta.id}>{meta.label}</option>)}
          </select></label>}
        {canManage&&<div className="flex flex-wrap gap-2">
          {template.components.map(component=><button key={component.id} type="button"
            className={BTN_QUIET} disabled={busy}
            onClick={()=>changeTemplate({components:template.components.filter(c=>c.id!==component.id)})}>
            移除 {TEMPLATE_COMPONENTS.find(meta=>meta.id===component.id)?.label??component.id}</button>)}
        </div>}
      </div>}
    </>}
  </section>
}

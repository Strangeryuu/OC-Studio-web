import { BUILTIN_CATEGORIES } from '@/lib/categories/builtins'
import { CATEGORY_ICON_NAMES } from '@/lib/categories/icons'
import { isReservedCategoryName, type Category } from '@/lib/categories/types'
import { BUILTIN_TEMPLATES } from '@/lib/templates/defaults'
import { TEMPLATE_COMPONENTS } from '@/lib/templates/registry'
import { isNoteTemplate } from '@/lib/templates/note'
import type { TemplateDoc, TemplateComponent } from '@/lib/templates/types'

export interface WorkspaceCustomization { categories: Category[]; templates: TemplateDoc[] }
export function defaultWorkspaceCustomization(): WorkspaceCustomization {
  return JSON.parse(JSON.stringify({ categories: BUILTIN_CATEGORIES, templates: BUILTIN_TEMPLATES })) as WorkspaceCustomization
}
const str=(value:unknown,min=1,max=100):value is string=>
  typeof value==='string'&&value.trim().length>=min&&value.length<=max
const object=(value:unknown):value is Record<string,unknown>=>
  !!value&&typeof value==='object'&&!Array.isArray(value)
const templateMap=new Map(BUILTIN_TEMPLATES.map(item=>[item.id,item]))
const categoryMap=new Map(BUILTIN_CATEGORIES.map(item=>[item.id,item]))
const icons=new Set<string>(CATEGORY_ICON_NAMES)
const componentIds=new Set(TEMPLATE_COMPONENTS.map(item=>item.id))

export function readWorkspaceCustomization(value: unknown): WorkspaceCustomization | null {
  if(!object(value)||!Array.isArray(value.categories)||!Array.isArray(value.templates)||
      value.categories.length>100||value.templates.length>100) return null
  const categories:Category[]=[]
  const templates:TemplateDoc[]=[]
  const templateIds=new Set<string>(), templateNames=new Set<string>()
  for(const raw of value.templates){
    if(!object(raw)||!str(raw.id,1,90)||!str(raw.name,1,100)||
       !Array.isArray(raw.aliases)||raw.aliases.length>15||
       !raw.aliases.every(x=>str(x,1,100))||
       !Array.isArray(raw.components)||raw.components.length>25||
       (raw.theme!==undefined&&!str(raw.theme,1,80))||
       (raw.schema!==undefined&&(!Number.isSafeInteger(raw.schema)||Number(raw.schema)<0||Number(raw.schema)>100)))return null
    if(templateIds.has(raw.id)||templateNames.has(raw.name.trim().toLowerCase()))return null
    if(!templateMap.has(raw.id)&&!/^custom-[a-zA-Z0-9-]{1,80}$/.test(raw.id))return null
    templateIds.add(raw.id);templateNames.add(raw.name.trim().toLowerCase())
    const components:TemplateComponent[]=[]
    const seen=new Set<string>()
    for(const component of raw.components){
      if(!object(component)||!str(component.id)||!componentIds.has(component.id)||
        seen.has(component.id)||typeof component.enabled!=='boolean')return null
      seen.add(component.id)
      if(component.params!==undefined){
        if(!object(component.params)||Object.keys(component.params).length>20)return null
        const meta=TEMPLATE_COMPONENTS.find(item=>item.id===component.id)
        const allowed=new Set(meta?.params??[])
        for(const [key,entry] of Object.entries(component.params)){
          if(!allowed.has(key)||
            !(typeof entry==='string'&&entry.length<=500||
            typeof entry==='boolean'||
            typeof entry==='number'&&Number.isFinite(entry)||
            Array.isArray(entry)&&entry.length<=100&&entry.every(i=>typeof i==='string'&&i.length<=100)))return null
        }
      }
      components.push({id:component.id as TemplateComponent['id'],enabled:component.enabled,
        ...(component.params===undefined?{}:{params:component.params as TemplateComponent['params']})})
    }
    templates.push({id:raw.id,name:raw.name.trim(),aliases:[...raw.aliases] as string[],
      components,...(raw.theme===undefined?{}:{theme:raw.theme as string}),
      ...(raw.schema===undefined?{}:{schema:raw.schema as number})})
  }
  // All original built-ins keep their stable IDs and remain configurable.
  if([...templateMap.keys()].some(id=>!templateIds.has(id)))return null
  const catNames=new Set<string>(),catIds=new Set<string>()
  for(const raw of value.categories){
    if(!object(raw)||!str(raw.id,1,90)||!str(raw.name,1,100)||
       typeof raw.enabled!=='boolean'||!Number.isSafeInteger(raw.order)||
       Number(raw.order)<0||Number(raw.order)>100000||
       !str(raw.template,1,90)||!templateIds.has(raw.template)||
       !str(raw.icon,1,50)||!icons.has(raw.icon)||catIds.has(raw.id)||
       catNames.has(raw.name.trim().toLowerCase()))return null
    const builtin=categoryMap.get(raw.id)
    if(builtin){
      if(raw.name!==builtin.name||raw.template!==builtin.template||raw.icon!==builtin.icon||
         raw.builtin!==true)return null
    }else if(!/^cat-[a-zA-Z0-9-]{1,80}$/.test(raw.id)||isReservedCategoryName(raw.name)||
      raw.builtin===true)return null
    catIds.add(raw.id);catNames.add(raw.name.trim().toLowerCase())
    const category: Category = {id:raw.id,name:raw.name.trim(),template:raw.template,
      icon:raw.icon as Category['icon'],order:raw.order as number,enabled:raw.enabled}
    if(builtin)category.builtin=true
    categories.push(category)
  }
  if([...categoryMap.keys()].some(id=>!catIds.has(id)))return null
  // Categories bind to a complete, renderable original note template.
  for(const category of categories){
    if(!isNoteTemplate(templates.find(t=>t.id===category.template)!))return null
  }
  return {categories,templates}
}

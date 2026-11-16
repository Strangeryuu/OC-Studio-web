'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Save, Trash2, RotateCcw } from 'lucide-react'
import { BUILTIN_FIELDS } from '@/lib/fields/defaults'
import type { FieldDef } from '@/lib/fields/types'
import {
  defaultCloudCharacterConfig, moveInList,
  parseCloudCharacterConfig, validCustomFieldKey,
  type CloudCharacterConfig, type CloudCharacterComponentId,
} from '@/lib/cloud/character-config'

const COMPONENT_LABELS: Record<CloudCharacterComponentId, string> = {
  avatar: '角色头像与立绘',
  info: '基本信息',
  summary: '人物简介',
  body: '正文编辑器（始终显示）',
}

export function CloudCharacterSettings({ workspaceId, editable, initialConfig, initialVersion }: {
  workspaceId: string
  editable: boolean
  initialConfig: CloudCharacterConfig
  initialVersion: number
}) {
  const [config, setConfig] = useState(initialConfig)
  const [version, setVersion] = useState(initialVersion)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [newKey, setNewKey] = useState('')
  const [missingId, setMissingId] = useState('')

  function change(next: CloudCharacterConfig) {
    if (!editable) return
    setConfig(next)
    setDirty(true)
    setError(null)
  }
  function rename(index: number, label: string) {
    change({ ...config, fields: config.fields.map((field, i) => i === index ? { ...field, label } : field) })
  }
  function addCustom() {
    const key = newKey.trim()
    const label = newLabel.trim()
    if (!label || label.length > 60 || !validCustomFieldKey(key) ||
      config.fields.some(field => field.key === key)) {
      setError('请填写有效的字段名称与不重复的字段键；字段键可使用中英文、数字和下划线。')
      return
    }
    if (config.fields.length >= 60) {
      setError('每个世界观最多配置 60 个角色字段。')
      return
    }
    const field: FieldDef = {
      id: 'f_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16),
      label, key, type: 'text',
    }
    change({ ...config, fields: [...config.fields, field] })
    setNewLabel('')
    setNewKey('')
  }

  async function save() {
    if (!editable || busy || !dirty) return
    const normalized = parseCloudCharacterConfig(config)
    if (!normalized) {
      setError('字段配置不完整，请检查重复键、空名称或组件设置。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/workspaces/' + workspaceId + '/character-config', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: version, config: normalized }),
      })
      if (response.status === 409) {
        setError('其他管理员已修改过模板。请复制当前配置后刷新页面，合并最新设置。')
        return
      }
      if (!response.ok) throw new Error('保存失败：HTTP ' + response.status)
      const result: { config: CloudCharacterConfig; version: number } = await response.json()
      setConfig(result.config)
      setVersion(result.version)
      setDirty(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const available = BUILTIN_FIELDS.character.filter(field => !config.fields.some(item => item.id === field.id))
  const valid = parseCloudCharacterConfig(config) !== null

  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <a href={'/workspaces/' + workspaceId} className="text-sm opacity-70">返回世界观</a>
      <div className="flex items-center gap-2">
        <span className="text-xs opacity-70">配置版本 {version}</span>
        {editable && <button type="button" disabled={!dirty || busy || !valid}
          onClick={() => void save()}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--oc-line)] px-4 py-2 text-sm disabled:opacity-50">
          <Save size={16} />{busy ? '保存中…' : '保存模板设置'}
        </button>}
      </div>
    </div>
    <div>
      <h1 className="text-2xl font-semibold">角色模板与字段设置</h1>
      <p className="mt-2 text-sm opacity-70">沿用 OC Studio 原版字段定义。设置属于当前世界观，修改后同项目所有角色共用。</p>
    </div>
    {error && <p role="alert" className="rounded-md border border-[var(--oc-line)] p-3 text-sm">{error}</p>}
    <section className="rounded-lg border border-[var(--oc-line)] p-5">
      <h2 className="mb-4 font-semibold">角色版面组件</h2>
      <p className="mb-3 text-xs opacity-70">支持更改组件顺序和显示状态。正文编辑器始终保留。</p>
      <div className="flex flex-col gap-2">{config.components.map((component, index) =>
        <div key={component.id} className="flex items-center gap-2 rounded border border-[var(--oc-line)] p-2">
          <input type="checkbox" aria-label={'显示' + COMPONENT_LABELS[component.id]}
            checked={component.enabled} disabled={!editable || component.id === 'body'}
            onChange={event => change({
              ...config, components: config.components.map(c => c.id === component.id ? { ...c, enabled: event.target.checked } : c),
            })} />
          <span className="flex-1 text-sm">{COMPONENT_LABELS[component.id]}</span>
          <button type="button" title="上移" aria-label={'上移' + COMPONENT_LABELS[component.id]}
            disabled={!editable || index === 0}
            onClick={() => change({ ...config, components: moveInList(config.components, index, -1) })}>
            <ArrowUp size={16}/>
          </button>
          <button type="button" title="下移" aria-label={'下移' + COMPONENT_LABELS[component.id]}
            disabled={!editable || index === config.components.length - 1}
            onClick={() => change({ ...config, components: moveInList(config.components, index, 1) })}>
            <ArrowDown size={16}/>
          </button>
        </div>)}</div>
    </section>
    <section className="rounded-lg border border-[var(--oc-line)] p-5">
      <h2 className="mb-3 font-semibold">基本信息字段</h2>
      <p className="mb-4 text-xs opacity-70">上移、下移、重命名或隐藏字段。移除字段仅影响显示，保留角色原始数据。</p>
      <div className="flex flex-col gap-2">
        {config.fields.map((field, index) => <div key={field.id} className="flex flex-wrap items-center gap-2 rounded border border-[var(--oc-line)] p-2">
          <input aria-label={'字段名称 ' + field.id} value={field.label} disabled={!editable} maxLength={60}
            onChange={event => rename(index, event.target.value)}
            className="min-w-0 flex-1 rounded bg-transparent px-2 py-1 text-sm" />
          <span className="text-xs opacity-60">{field.key ? '自定义' : '内置'}</span>
          <button type="button" title="上移字段" disabled={!editable || index === 0}
            onClick={() => change({ ...config, fields: moveInList(config.fields, index, -1) })}><ArrowUp size={16}/></button>
          <button type="button" title="下移字段" disabled={!editable || index === config.fields.length - 1}
            onClick={() => change({ ...config, fields: moveInList(config.fields, index, 1) })}><ArrowDown size={16}/></button>
          <button type="button" title="隐藏字段" disabled={!editable}
            onClick={() => change({ ...config, fields: config.fields.filter(item => item.id !== field.id) })}><Trash2 size={16}/></button>
        </div>)}
      </div>
      {editable && <div className="mt-5 flex flex-wrap gap-2">
        <select aria-label="可恢复的内置字段" value={missingId} onChange={event => setMissingId(event.target.value)}
          className="min-w-0 flex-1 rounded border border-[var(--oc-line)] bg-[var(--oc-paper)] px-2 py-2 text-sm">
          <option value="">选择隐藏的内置字段</option>
          {available.map(field => <option value={field.id} key={field.id}>{field.label}</option>)}
        </select>
        <button type="button" disabled={!missingId || config.fields.length >= 60}
          className="rounded border border-[var(--oc-line)] px-3 py-2 text-sm"
          onClick={() => {
            const field = available.find(item => item.id === missingId)
            if (!field) return
            change({ ...config, fields: [...config.fields, { ...field }] })
            setMissingId('')
          }}><RotateCcw size={14} className="inline" /> 恢复字段</button>
      </div>}
      {editable && <div className="mt-5 border-t border-[var(--oc-line)] pt-4">
        <h3 className="mb-3 text-sm font-semibold">新增自定义字段</h3>
        <div className="flex flex-wrap gap-2">
          <input aria-label="新字段名称" value={newLabel} onChange={event => setNewLabel(event.target.value)}
            placeholder="显示名称，如：能力" maxLength={60}
            className="min-w-0 flex-1 rounded border border-[var(--oc-line)] bg-transparent px-3 py-2 text-sm" />
          <input aria-label="新字段键" value={newKey} onChange={event => setNewKey(event.target.value)}
            placeholder="字段键，如：能力设定" maxLength={64}
            className="min-w-0 flex-1 rounded border border-[var(--oc-line)] bg-transparent px-3 py-2 text-sm" />
          <button type="button" onClick={addCustom}
            className="inline-flex items-center gap-1 rounded border border-[var(--oc-line)] px-3 py-2 text-sm">
            <Plus size={14}/>添加字段
          </button>
        </div>
      </div>}
    </section>
  </div>
}

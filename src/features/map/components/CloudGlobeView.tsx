'use client'

import dynamic from 'next/dynamic'
import {useEffect,useState} from 'react'
import type {MapLayers} from '@/plugins/map-generator'
import {buildGlobeLayers,decodeGlobeImage,worldMapParameters} from '@/features/map/globe-data'
import {LOADING_TEXT} from '@/lib/ui-tokens'

const GlobeCanvas=dynamic(
  ()=>import('./GlobeCanvas').then(module=>module.GlobeCanvas),{ssr:false},
)

/**
 * The globe is read-only: map edits, pins and the original 2D surface remain
 * untouched, while generated maps may hydrate real height displacement.
 */
export function CloudGlobeView({imageUrl,seed,paramsJson}:{
  imageUrl:string
  seed?:number
  paramsJson?:string
}) {
  const [image,setImage]=useState<ImageData|null>(null)
  const [layers,setLayers]=useState<MapLayers|null>(null)
  const [loadingError,setLoadingError]=useState<string|null>(null)
  const [heightError,setHeightError]=useState<string|null>(null)
  const [progress,setProgress]=useState<{stage:string;value:number}|null>(null)

  useEffect(()=>{
    const controller=new AbortController()
    const active=()=>!controller.signal.aborted
    void decodeGlobeImage(imageUrl,controller.signal).then(result=>{
      if(active())setImage(result)
    }).catch(cause=>{
      if(active())setLoadingError(cause instanceof Error?cause.message:'地球纹理读取失败')
    })

    let params=null
    try {
      if(paramsJson)params=worldMapParameters(JSON.parse(paramsJson) as unknown)
    }catch {/* An imported map with legacy params still gets the 2D texture. */}
    if(params&&seed!==undefined) {
      void buildGlobeLayers({
        seed,params,signal:controller.signal,
        onProgress:(stage,value)=>{if(active())setProgress({stage,value})},
      }).then(result=>{
        if(active()){
          setLayers(result)
          setProgress(null)
        }
      }).catch(cause=>{
        if(active()){
          setHeightError(cause instanceof Error?cause.message:'无法还原原始高程')
          setProgress(null)
        }
      })
    }
    return ()=>controller.abort()
  },[imageUrl,seed,paramsJson])

  return <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-paper"
    data-testid="cloud-globe-view">
    {image?<GlobeCanvas image={image} layers={layers}/>:<div role="status"
      className="flex h-full min-h-64 items-center justify-center px-5 text-center">
      <span className={loadingError?'text-caption text-error':LOADING_TEXT}>
        {loadingError??'正在读取私有地图并建立球面网格…'}
      </span>
    </div>}
    {image&&!loadingError&&progress&&<div role="status"
      className="absolute bottom-12 left-1/2 max-w-[92%] -translate-x-1/2 rounded-control border border-line bg-paper/90 px-3 py-1 text-caption text-ink-muted">
      正在恢复高程：{progress.stage} · {Math.round(progress.value*100)}%
    </div>}
    {heightError&&image&&<p role="status"
      className="absolute bottom-3 left-3 right-3 rounded-control border border-line bg-paper/90 p-2 text-caption text-ink-muted">
      高程数据暂时不可用，仍可查看球面底图：{heightError}
    </p>}
  </div>
}

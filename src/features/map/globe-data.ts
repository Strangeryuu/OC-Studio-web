/**
 * OC-editor globe's in-memory inputs, rebuilt from cloud-owned private map
 * media and the same seeded map-generator worker used by the 2D views.
 * No new persistence, external image proxy or public-media permissions.
 */
import {
  createMapGeneratorWorker, normalizeMapParams,
  type MapLayers, type WorldMapParams, type WorkerResponse,
} from '@/plugins/map-generator'

export function canProjectMapAsGlobe(width:unknown,height:unknown):boolean {
  if(typeof width!=='number'||typeof height!=='number'||
    !Number.isFinite(width)||!Number.isFinite(height)||height<=0)return false
  const ratio=width/height
  return ratio>=1.75&&ratio<=2.25&&width>=256&&height>=128
}

export function worldMapParameters(value:unknown):WorldMapParams|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null
  const record=value as Record<string,unknown>
  if(record.kind!=='world')return null
  return normalizeMapParams(value as WorldMapParams)
}

export async function decodeGlobeImage(src:string,signal?:AbortSignal):Promise<ImageData> {
  if(!src.startsWith('/api/media/')&&!src.startsWith('blob:')&&
     !src.startsWith('data:image/'))throw new Error('只支持当前资料库的私有地图底图')
  const response=await fetch(src,{credentials:'same-origin',cache:'no-store',signal})
  if(!response.ok)throw new Error('读取地图底图失败，请确认当前账号具有访问权限')
  const blob=await response.blob()
  if(signal?.aborted)throw new Error('MAP_GLOBE_CANCELLED')
  const bitmap=await createImageBitmap(blob)
  try {
    // Cap memory and GPU upload cost while keeping the equirectangular ratio.
    const factor=Math.min(1,2048/bitmap.width,1024/bitmap.height)
    const width=Math.max(1,Math.round(bitmap.width*factor))
    const height=Math.max(1,Math.round(bitmap.height*factor))
    const canvas=document.createElement('canvas')
    canvas.width=width
    canvas.height=height
    const context=canvas.getContext('2d',{willReadFrequently:true})
    if(!context)throw new Error('当前浏览器无法创建地图采样画布')
    context.drawImage(bitmap,0,0,width,height)
    return context.getImageData(0,0,width,height)
  } finally {bitmap.close()}
}

export async function buildGlobeLayers(options:{
  seed:number
  params:WorldMapParams
  signal?:AbortSignal
  onProgress?:(stage:string,value:number)=>void
  timeoutMs?:number
}):Promise<MapLayers> {
  if(!Number.isSafeInteger(options.seed))throw new Error('地图种子不完整')
  const params=normalizeMapParams(options.params)
  if(params.kind!=='world')throw new Error('地球高度图仅支持世界地图')
  if(options.signal?.aborted)throw new Error('MAP_GLOBE_CANCELLED')
  const worker=createMapGeneratorWorker()
  const timeoutMs=options.timeoutMs??60_000
  try {
    return await new Promise<MapLayers>((resolve,reject)=>{
      let settled=false
      const finish=(error:Error|null,layers?:MapLayers)=>{
        if(settled)return
        settled=true
        window.clearTimeout(timer)
        options.signal?.removeEventListener('abort',abort)
        if(error)reject(error)
        else if(layers)resolve(layers)
        else reject(new Error('地球高程采样失败'))
      }
      const abort=()=>finish(new Error('MAP_GLOBE_CANCELLED'))
      const timer=window.setTimeout(()=>finish(new Error('地球高程采样超时')),timeoutMs)
      options.signal?.addEventListener('abort',abort,{once:true})
      worker.addEventListener('message',(event:MessageEvent<WorkerResponse>)=>{
        const message=event.data
        if(message.requestId!==1)return
        if(message.type==='progress'){
          options.onProgress?.(message.stage,message.value)
        } else if(message.type==='error'){
          finish(new Error(message.message||'地球高程采样失败'))
        } else if(message.type==='generated'){
          const size=message.meta.width*message.meta.height
          if(size<=0||size>4096*4096||
            message.height.byteLength!==size*2||
            message.biome.byteLength!==size||
            message.water.byteLength!==size||
            message.temperature.byteLength!==size*2||
            message.moisture.byteLength!==size) {
            finish(new Error('地图高程数据长度异常'))
            return
          }
          finish(null,{
            height:new Int16Array(message.height),
            biome:new Uint8Array(message.biome),
            water:new Uint8Array(message.water),
            temperature:new Int16Array(message.temperature),
            moisture:new Uint8Array(message.moisture),
            width:message.meta.width,mapHeight:message.meta.height,
          })
        }
      })
      worker.addEventListener('error',()=>finish(new Error('地球生成 Worker 运行失败')))
      worker.postMessage({type:'generate',requestId:1,seed:options.seed,params})
    })
  } finally {worker.terminate()}
}

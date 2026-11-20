import {describe,expect,it} from 'vitest'
import {canProjectMapAsGlobe,worldMapParameters} from '@/features/map/globe-data'
import {buildGlobeMesh} from '@/features/map/components/GlobeCanvas'
import {DEFAULT_MAP_PARAMS, type MapLayers} from '@/plugins/map-generator'

function flatImage(width:number,height:number):ImageData {
  const data=new Uint8ClampedArray(width*height*4)
  for(let i=0;i<data.length;i+=4){
    data[i]=120;data[i+1]=170;data[i+2]=220;data[i+3]=255
  }
  return {width,height,data,colorSpace:'srgb'} as ImageData
}

describe('cloud map 3D globe and profile compatibility',()=>{
  it('offers equirectangular world maps but guards square regional maps',()=>{
    expect(canProjectMapAsGlobe(3072,1536)).toBe(true)
    expect(canProjectMapAsGlobe(2048,1024)).toBe(true)
    expect(canProjectMapAsGlobe(1024,1024)).toBe(false)
    expect(canProjectMapAsGlobe(500,400)).toBe(false)
    expect(canProjectMapAsGlobe(undefined,1536)).toBe(false)
    expect(canProjectMapAsGlobe(3072,0)).toBe(false)
  })
  it('normalizes persisted world snapshots and excludes region snapshots',()=>{
    const world=worldMapParameters({...DEFAULT_MAP_PARAMS,
      width:3072,height:1536,mountainStrength:0.9})
    expect(world).toMatchObject({kind:'world',width:3072,height:1536,mountainStrength:0.9})
    expect(worldMapParameters({...DEFAULT_MAP_PARAMS,kind:'region'})).toBeNull()
    expect(worldMapParameters({})).toBeNull()
    expect(worldMapParameters(null)).toBeNull()
  })
  it('builds a complete six-face globe without malformed coordinates',()=>{
    const mesh=buildGlobeMesh(flatImage(32,16),null,0)
    expect(mesh.positions.length).toBe(6*25*25*3)
    expect(mesh.indexCount).toBe(6*24*24*6)
    for(let i=0;i<mesh.positions.length;i+=3){
      const x=mesh.positions[i],y=mesh.positions[i+1],z=mesh.positions[i+2]
      expect(Number.isFinite(x+y+z)).toBe(true)
      expect(Math.hypot(x,y,z)).toBeCloseTo(1,5)
    }
    expect([...mesh.colors.slice(0,3)]).toEqual([
      120/255,170/255,220/255,
    ].map(x=>Math.fround(x)))
  })
  it('uses generator height displacement even when the texture was downscaled',()=>{
    const width=32,height=16
    const elevations=new Int16Array(width*height).fill(8000)
    const layers:MapLayers={
      height:elevations,biome:new Uint8Array(width*height),
      water:new Uint8Array(width*height),
      temperature:new Int16Array(width*height),
      moisture:new Uint8Array(width*height),width,mapHeight:height,
    }
    const mesh=buildGlobeMesh(flatImage(16,8),layers,0)
    const first=mesh.positions.slice(0,3)
    expect(Math.hypot(...first)).toBeCloseTo(1.025,4)
  })
})

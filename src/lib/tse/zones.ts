import { z } from 'zod';
import path from 'node:path';
import { FileBackedCache } from './cache';
import { resultSchema } from './schemas';
import { normalizeResult } from './normalizers';
import { resultUrl } from './urls';
import { catalog,client,POLL_MS,QueryError } from './service';
import type { ElectionConfig } from './types';
import type { ZoneResult,ZoneResponse } from './zone-types';
const zoneSchema=resultSchema.extend({tpabr:z.literal('zona'),cdabr:z.string().regex(/^\d{4}$/)});
export function zoneUrl(config:ElectionConfig,uf:string,municipality:string,zone:string){
  if(!/^[a-z]{2}$/.test(uf)||uf==='zz'||!/^\d{5}$/.test(municipality)||!/^\d{4}$/.test(zone))throw new QueryError('Zona inválida');
  return resultUrl(config,{type:'municipality',state:uf,code:municipality,name:municipality}).replace('-c0001-',`-z${zone}-c0001-`);
}
export function normalizeZone(input:unknown,config:ElectionConfig,uf:string,municipality:string,zone:string,sourceUrl:string):ZoneResult{
  const raw=zoneSchema.parse(input);
  if(raw.cdabr!==zone||raw.ele!==config.election||raw.dv!=='s')throw new Error('Zone identity or disclosure mismatch');
  // EA20 shares the electoral fields. Validate the zone identity before reusing
  // the existing electoral field normalizer; never modify its national rules.
  const snapshot=normalizeResult({...input as Record<string,unknown>,tpabr:'mu',cdabr:municipality},config,{type:'municipality',state:uf,code:municipality,name:municipality},sourceUrl);
  return {number:zone,version:snapshot.version,progress:snapshot.progress,candidates:snapshot.candidates,sourceUrl,checkedAt:null,stale:false,issue:null};
}
const runtime=globalThis as typeof globalThis&{zoneFlights?:Map<string,Promise<ZoneResponse>>;zoneCursors?:Map<string,number>};
const flights=runtime.zoneFlights??=new Map();const cursors=runtime.zoneCursors??=new Map();
const savedZones=new FileBackedCache(path.resolve(/* turbopackIgnore: true */ process.env.TSE_CACHE_DIR || '.cache/tse'));
export async function zones(uf:string,municipality:string):Promise<ZoneResponse>{
  const key=uf+municipality;const pending=flights.get(key);if(pending)return pending;
  const operation=readZones(uf,municipality);flights.set(key,operation);
  try{return await operation;}finally{flights.delete(key);}
}
async function readZones(uf:string,municipality:string):Promise<ZoneResponse>{
  const {config,geography}=await catalog();
  const town=geography?.value?.find(g=>g.code===uf)?.municipalities.find(m=>m.code===municipality);
  if(!config.value||!town||uf==='zz')throw new QueryError('Município inválido');
  const numbers=[...new Set(town.zones??[])].filter(z=>/^\d{4}$/.test(z)).sort();
  const cursor=cursors.get(uf+municipality)??0;
  for(let i=0;i<Math.min(3,numbers.length);i++){
    if(client.cooldownUntil>Date.now())break;
    const zone=numbers[(cursor+i)%numbers.length],url=zoneUrl(config.value,uf,municipality,zone);
    await client.read(url,raw=>normalizeZone(raw,config.value!,uf,municipality,zone,url),Math.max(POLL_MS,10000));
    cursors.set(uf+municipality,(cursor+i+1)%numbers.length);
  }
  const results=await Promise.all(numbers.map(async number=>{
    const sourceUrl=zoneUrl(config.value!,uf,municipality,number),entry=client.peek<ZoneResult>(sourceUrl);
    const checkedAt=entry?.checkedAt?new Date(entry.checkedAt).toISOString():null;
    const issue=entry?.issue??null;
    if(!entry?.value){
      const saved=await savedZones.get(sourceUrl);
      if(saved)try{return {...normalizeZone(JSON.parse(saved.body),config.value!,uf,municipality,number,sourceUrl),checkedAt:new Date(saved.checkedAt).toISOString(),stale:true,issue:issue??'Último resultado recebido; atualização pendente'};}catch{/* Never display an incompatible saved zone. */}
    }
    return entry?.value?{...entry.value,checkedAt,stale:!!issue,issue}:{number,sourceUrl,checkedAt,version:null,progress:null,candidates:[],stale:true,issue:issue??'Resultado ainda não recebido'};
  }));
  return {uf,municipality,zones:results,nextPollMs:15000,geometryAvailable:false};
}

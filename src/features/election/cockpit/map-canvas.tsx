'use client';
import {MapTooltip} from './map-tooltip';
import {zoneLabel,zoneNeighborhood} from './zone-labels';
import './cartography.css';
import type {CandidateResult} from '@/lib/tse/types';
import {memo,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {editorialName} from './editorial-name';
import {readMapTheme} from './map-theme';
import {useHoverMetric} from './use-hover-metric';
import national from '../map/geometry.json';
import type {ElectionMapSnapshot} from '@/lib/tse/map-types';
import type {MunicipalMetric} from '@/lib/tse/municipal-map';
import type {ZoneResult} from '@/lib/tse/zone-types';
import {candidateColor} from '@/lib/tse/candidate-colors';
import {percent,number} from '@/lib/format';
import {municipalGeometry,mapFill,type MapMode,type Shape} from './map-resources';
import {MUNICIPAL_ZOOM,LOCAL_ZOOM,NATIONAL_VIEW,SpatialIndex,collisionFreeLabels,fitBounds,interpolateView,zoomView,type View,type Bounds} from './map-navigation';
/** The site's font (loaded by next/font) for labels drawn on the canvas. */
let labelFont='';const fontFamily=()=>(labelFont||=getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim()||'Arial');
const states=new SpatialIndex<Shape>(national.states);
type Hover={shape:Shape;x:number;y:number};
type Props={candidateRegistry?:CandidateResult[];snapshot:ElectionMapSnapshot|null;metrics:MunicipalMetric[];uf:string;town:string;mode:MapMode;candidate:string;onSelect:(uf:string,town?:string)=>void;selectedName:string;onVisibleStates?:(states:string[])=>void;zones?:ZoneResult[];zone?:string;hoveredZone?:string;historical?:boolean;onZoneSelect?:(zone:string)=>void;onZoneHover?:(zone:string)=>void};
export const CockpitMap=memo(function CockpitMap({candidateRegistry=[],snapshot,metrics,uf,town,mode,candidate,onSelect,selectedName,onVisibleStates,zones=[],zone='',hoveredZone='',historical=false,onZoneSelect,onZoneHover}:Props){
  const canvas=useRef<HTMLCanvasElement>(null),container=useRef<HTMLDivElement>(null),base=useRef<HTMLCanvasElement|null>(null);
  const [loaded,setLoaded]=useState<Record<string,Shape[]>>({}),[view,setView]=useState<View>([...NATIONAL_VIEW]);
  const [theme,setTheme]=useState<ReturnType<typeof readMapTheme>|null>(null);
  useEffect(()=>{const frame=requestAnimationFrame(()=>setTheme(readMapTheme()));return()=>cancelAnimationFrame(frame);},[]);
  const [hover,setHover]=useState<Hover|null>(null),[error,setError]=useState(''),[size,setSize]=useState([760,680]),[animating,setAnimating]=useState(false);
  const paths=useRef(new Map<string,Path2D>()),viewRef=useRef(view),animation=useRef(0),hoverFrame=useRef(0),fitted=useRef('');
  const touches=useRef(new Map<number,{x:number;y:number}>()),pinch=useRef<number|null>(null),drag=useRef<{x:number;y:number;view:View;moved:boolean}|null>(null);
  const hoverRef=useRef(hover);viewRef.current=view;hoverRef.current=hover;
  const zoomLevel=NATIONAL_VIEW[2]/view[2],level=zoomLevel>=LOCAL_ZOOM?'local':zoomLevel>=MUNICIPAL_ZOOM?'regional':'national';
  const municipal=!!town||mode!=='states';
  const scale=Math.min(size[0]/view[2],size[1]/view[3]),offset=useMemo(()=>[(size[0]-view[2]*scale)/2,(size[1]-view[3]*scale)/2],[size,view,scale]);
  const bounds=useMemo(()=>[view[0]-offset[0]/scale,view[1]-offset[1]/scale,view[0]+(size[0]-offset[0])/scale,view[1]+(size[1]-offset[1])/scale] as Bounds,[view,offset,size,scale]);
  const visibleStates=useMemo(()=>states.query(bounds).filter(s=>!uf||s.uf===uf),[bounds,uf]),visibleKey=visibleStates.map(s=>s.uf).sort().join(',');
  useEffect(()=>{onVisibleStates?.(municipal?visibleKey.split(',').filter(Boolean):[]);},[municipal,visibleKey,onVisibleStates]);
  useEffect(()=>{if(!municipal&&!uf)return;let cancelled=false;const wanted=uf?[uf]:visibleKey.split(',').filter(Boolean);
    void(async()=>{for(let i=0;i<wanted.length;i+=3){if(cancelled)break;const batch=await Promise.allSettled(wanted.slice(i,i+3).map(async state=>[state,await municipalGeometry(state)] as const));if(cancelled)break;setLoaded(previous=>{const next={...previous};for(const item of batch)if(item.status==='fulfilled')next[item.value[0]]=item.value[1];return next;});if(batch.some(item=>item.status==='rejected'))setError('Uma malha municipal não pôde ser carregada. Reaproxime para tentar novamente.');}})();return()=>{cancelled=true;};
  },[municipal,uf,visibleKey]);
  useEffect(()=>{const node=container.current;if(!node)return;const observer=new ResizeObserver(([e])=>setSize([e.contentRect.width,e.contentRect.height]));observer.observe(node);return()=>observer.disconnect();},[]);
  const shapes=useMemo(()=>Object.values(loaded).flat(),[loaded]),index=useMemo(()=>new SpatialIndex(shapes),[shapes]);
  const displayed=useMemo(()=>municipal?index.query(bounds).filter(s=>!uf||s.uf===uf):visibleStates,[municipal,index,bounds,uf,visibleStates]);
  const municipalData=useMemo(()=>new Map(metrics.map(m=>[m.uf+m.code,m])),[metrics]),stateData=useMemo(()=>new Map(snapshot?.states.map(s=>[s.uf,s])??[]),[snapshot]);
  const lookup=useCallback((shape:Shape)=>{if(shape.code){const m=municipalData.get(shape.uf+shape.code);return m?{counted:m.counted,candidates:m.candidates,validVotes:m.validVotes}:undefined;}const s=stateData.get(shape.uf);return s?{counted:s.countedPercentage,candidates:s.candidates??[s.leader,s.runnerUp].filter(c=>c!==null),validVotes:s.validVotes}:undefined;},[municipalData,stateData]);
  const stop=useCallback(()=>{cancelAnimationFrame(animation.current);animation.current=0;setAnimating(false);},[]);
  const animate=useCallback((target:View,via?:View)=>{cancelAnimationFrame(animation.current);const from=viewRef.current;if(matchMedia('(prefers-reduced-motion: reduce)').matches){setView(target);setAnimating(false);return;}setAnimating(true);const start=performance.now(),duration=via?480:340;
    const frame=(now:number)=>{const t=Math.min(1,(now-start)/duration);setView(via?(t<.42?interpolateView(from,via,t/.42):interpolateView(via,target,(t-.42)/.58)):interpolateView(from,target,t));if(t<1)animation.current=requestAnimationFrame(frame);else{animation.current=0;setAnimating(false);}};animation.current=requestAnimationFrame(frame);
  },[]);
  const fit=useCallback(()=>{if(!uf){animate([...NATIONAL_VIEW]);return;}const items=loaded[uf];if(!items?.length)return;const selected=town?items.find(s=>s.code===town):null,state=national.states.find(s=>s.uf===uf),b=state?states.bounds.get(state):null;
    const target=selected?fitBounds(index.bounds.get(selected)!):b?fitBounds(b):null;if(target)animate(target,selected&&b&&viewRef.current[2]>(b[2]-b[0])*2?fitBounds(b):undefined);
  },[uf,town,loaded,index,animate]);
  useEffect(()=>{const key=uf+town;if(fitted.current===key)return;if(uf&&!loaded[uf]?.some(s=>!town||s.code===town))return;const frame=requestAnimationFrame(()=>{fitted.current=key;fit();});return()=>cancelAnimationFrame(frame);},[uf,town,loaded,fit]);
  useEffect(()=>()=>{cancelAnimationFrame(animation.current);cancelAnimationFrame(hoverFrame.current);},[]);
  const path=useCallback((s:Shape)=>{const key=s.uf+(s.code??'');let p=paths.current.get(key);if(!p){p=new Path2D(s.path);paths.current.set(key,p);}return p;},[]);
  const paintHover=useCallback(()=>{const node=canvas.current,image=base.current;if(!node||!image)return;const ctx=node.getContext('2d');if(!ctx)return;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,node.width,node.height);ctx.drawImage(image,0,0);const s=hoverRef.current?.shape;if(!s)return;ctx.fillStyle=readMapTheme().neighborDim;ctx.fillRect(0,0,node.width,node.height);const dpr=Math.min(devicePixelRatio||1,2);ctx.setTransform(dpr*scale,0,0,dpr*scale,dpr*(offset[0]-view[0]*scale),dpr*(offset[1]-view[1]*scale));const theme=readMapTheme();ctx.fillStyle=theme.highlight;ctx.fill(path(s),'evenodd');ctx.strokeStyle=theme.outline;ctx.lineWidth=2/scale;ctx.stroke(path(s));},[scale,offset,view,path]);
  useEffect(()=>{const node=canvas.current;if(!node||!size[0]||!size[1])return;const started=performance.now(),theme=readMapTheme();if(!base.current)base.current=document.createElement('canvas');const image=base.current,ctx=image.getContext('2d');if(!ctx)return;const dpr=Math.min(devicePixelRatio||1,2);image.width=node.width=Math.round(size[0]*dpr);image.height=node.height=Math.round(size[1]*dpr);ctx.setTransform(dpr*scale,0,0,dpr*scale,dpr*(offset[0]-view[0]*scale),dpr*(offset[1]-view[1]*scale));
    // Fill, municipal borders, state borders and selection are independent passes.
    const drawing=municipal?displayed:visibleStates;
    if(municipal){ctx.fillStyle=theme.empty;visibleStates.forEach(s=>ctx.fill(path(s),'evenodd'));}
    for(const shape of drawing){ctx.fillStyle=mapFill(mode,lookup(shape),candidate,theme);ctx.fill(path(shape),'evenodd');}
    ctx.strokeStyle=theme.border;ctx.lineWidth=(level==='national'?.32:level==='regional'?.5:.75)/scale;drawing.forEach(s=>ctx.stroke(path(s)));
    ctx.strokeStyle=theme.stateBorder;ctx.lineWidth=(municipal?1.35:1.1)/scale;visibleStates.forEach(s=>ctx.stroke(path(s)));
    const selected=town?displayed.find(s=>s.uf===uf&&s.code===town):visibleStates.find(s=>s.uf===uf);
    if(selected){ctx.strokeStyle=theme.outline;ctx.lineWidth=2.5/scale;ctx.stroke(path(selected));}
    const labelShapes=municipal&&level!=='national'?[...visibleStates,...displayed]:visibleStates;
    const labels=labelShapes.map(s=>{const b=(s.code?index:states).bounds.get(s)!,m=lookup(s),area=(b[2]-b[0])*(b[3]-b[1])*scale*scale,selected=s.code===town&&s.uf===uf,text=s.code?editorialName(s.name):s.uf.toUpperCase();
      if(s.code&&(!selected&&area<(level==='local'?20:40)))return null;
      if(!s.code&&level==='local')return null;
      const x=offset[0]+(s.label[0]-view[0])*scale,y=offset[1]+(s.label[1]-view[1])*scale;
      if(x<18||x>size[0]-18||y<65||y>size[1]-57)return null;
      if(!s.code&&level==='national'&&['rn','pb','pe','al','se','es','rj','df'].includes(s.uf))return null;
      ctx.font=`${s.code?11:12}px ${fontFamily()}`;
      return {key:s.uf+(s.code??''),x,y,width:ctx.measureText(text).width,height:s.code?16:32,priority:selected?1e12:!s.code?1e11:(m?.validVotes??area),shape:s,text};
    }).filter((l):l is NonNullable<typeof l>=>!!l);
    const accepted=collisionFreeLabels(labels,level==='local'?60:35),byKey=new Map(labels.map(l=>[l.key,l]));ctx.textAlign='center';ctx.textBaseline='middle';for(const box of accepted){const l=byKey.get(box.key)!;ctx.font=`${l.shape.code?'500':'600'} ${(l.shape.code?11:12)/scale}px ${fontFamily()}`;ctx.lineWidth=1.5/scale;ctx.strokeStyle=theme.canvas;ctx.fillStyle=theme.text;ctx.strokeText(l.text,l.shape.label[0],l.shape.label[1]);ctx.fillText(l.text,l.shape.label[0],l.shape.label[1]);if(!l.shape.code){const m=lookup(l.shape),v=mode==='counted'?m?.counted:mode==='candidate'?m?.candidates.find(c=>c.number===candidate)?.percentage:m?.candidates[0]?.percentage,text=v==null?'—':`${percent(v)}%`;ctx.font=`600 ${11/scale}px ${fontFamily()}`;ctx.strokeText(text,l.shape.label[0],l.shape.label[1]+15/scale);ctx.fillText(text,l.shape.label[0],l.shape.label[1]+15/scale);}}
    node.dataset.labelCount=String(accepted.length);node.dataset.visibleShapes=String(displayed.length);node.dataset.drawMs=(performance.now()-started).toFixed(2);paintHover();
  },[displayed,visibleStates,lookup,mode,candidate,uf,town,size,scale,offset,view,municipal,level,path,paintHover,index]);
  useEffect(()=>{const frame=requestAnimationFrame(paintHover);return()=>cancelAnimationFrame(frame);},[hover,paintHover]);
  const zoom=useCallback((factor:number,point?:[number,number])=>{stop();setView(v=>{const s=Math.min(size[0]/v[2],size[1]/v[3]),ox=(size[0]-v[2]*s)/2,oy=(size[1]-v[3]*s)/2;return zoomView(v,factor,point?[(point[0]-ox)/(v[2]*s),(point[1]-oy)/(v[3]*s)]:[.5,.5]);});},[size,stop]);
  useEffect(()=>{const node=canvas.current;if(!node)return;const wheel=(e:WheelEvent)=>{e.preventDefault();const r=node.getBoundingClientRect();zoom(Math.exp(Math.max(-120,Math.min(120,e.deltaY))*.0018),[e.clientX-r.left,e.clientY-r.top]);};node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);},[zoom]);
  const hit=(x:number,y:number)=>{const ctx=canvas.current?.getContext('2d');if(!ctx)return;const px=(x-offset[0])/scale+view[0],py=(y-offset[1])/scale+view[1];ctx.save();ctx.setTransform(1,0,0,1,0,0);const s=(municipal?index:states).query([px,py,px,py]).find(s=>(!uf||s.uf===uf)&&ctx.isPointInPath(path(s),px,py,'evenodd'));ctx.restore();return s;};
  const hoveredMetric=useHoverMetric(hover?.shape.uf??'',hover?.shape.code??'',!historical&&!!hover?.shape.code);
  const m=hover?(hover.shape.code&&hoveredMetric?{counted:hoveredMetric.counted,candidates:hoveredMetric.candidates,validVotes:hoveredMetric.validVotes}:lookup(hover.shape)):undefined,activeZone=zones.find(z=>z.number===(hoveredZone||zone));
  return <div className="cockpit-map" ref={container} data-hover={!!hover} data-detail={level} data-municipal={municipal} data-zoom={zoomLevel.toFixed(3)} data-view={view.join(',')} data-animating={animating}>
    <canvas ref={canvas} role="img" aria-label={`Mapa interativo: ${selectedName}. Zoom livre revela municípios; busca e navegação territorial disponíveis por teclado.`}
      onPointerDown={e=>{stop();e.currentTarget.setPointerCapture(e.pointerId);touches.current.set(e.pointerId,{x:e.clientX,y:e.clientY});drag.current={x:e.clientX,y:e.clientY,view:[...view],moved:false};}}
      onPointerMove={e=>{if(touches.current.has(e.pointerId))touches.current.set(e.pointerId,{x:e.clientX,y:e.clientY});if(touches.current.size===2){const [a,b]=[...touches.current.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);if(pinch.current)zoom(pinch.current/distance);pinch.current=distance;if(drag.current)drag.current.moved=true;return;}const d=drag.current;if(d&&touches.current.has(e.pointerId)){const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.hypot(dx,dy)>4)d.moved=true;setView([d.view[0]-dx/scale,d.view[1]-dy/scale,d.view[2],d.view[3]]);return;}const r=e.currentTarget.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,s=hit(x,y);cancelAnimationFrame(hoverFrame.current);hoverFrame.current=requestAnimationFrame(()=>setHover(s?{shape:s,x,y}:null));}}
      onPointerUp={e=>{const d=drag.current;touches.current.delete(e.pointerId);pinch.current=null;if(d&&!d.moved){const r=e.currentTarget.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,s=hit(x,y);if(s){setHover({shape:s,x,y});onSelect(s.uf,s.code??undefined);}}drag.current=null;}}
      onPointerCancel={()=>{drag.current=null;touches.current.clear();pinch.current=null;}} onPointerLeave={()=>{if(!drag.current)setHover(null);}}/>
    <div className="map-zoom"><button onClick={()=>zoom(1/1.4)} aria-label="Ampliar mapa">+</button><button onClick={()=>zoom(1.4)} aria-label="Reduzir mapa">−</button><button onClick={fit} aria-label="Enquadrar território"><svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" stroke="currentColor"/></svg></button></div>
    {level==='national'&&!uf&&<div className="map-callouts">{national.states.filter(s=>['rn','pb','pe','al','se','es','rj','df'].includes(s.uf)).map(s=><button key={s.uf} onClick={()=>onSelect(s.uf)}>{s.uf.toUpperCase()} <b>{percent(mode==='counted'?lookup(s)?.counted:lookup(s)?.candidates[0]?.percentage)}%</b></button>)}</div>}
    {hover&&<MapTooltip uf={hover.shape.uf} code={hover.shape.code??''} name={hover.shape.name} point={hover} viewport={size} metric={m} registry={candidateRegistry}/>}
    {town&&<div className="map-zone-controls"><b>Zonas eleitorais</b><small>Seleção sem posição geográfica · limites não disponíveis</small><div>{zones.map(z=><button key={z.number} aria-label={`Zona ${Number(z.number)} no mapa`} title={zoneLabel(uf,town,z.number)} aria-pressed={zone===z.number} className={hoveredZone===z.number?'is-highlighted':''} onPointerEnter={()=>onZoneHover?.(z.number)} onPointerLeave={()=>onZoneHover?.('')} onFocus={()=>onZoneHover?.(z.number)} onBlur={()=>onZoneHover?.('')} onClick={()=>onZoneSelect?.(z.number)}><i style={{background:z.candidates[0]?candidateColor(z.candidates[0]):'var(--map-tie)' }}/>{Number(z.number)}</button>)}</div></div>}
    {town&&activeZone&&<div className="cockpit-tooltip zone-tooltip" role="status" data-zone={activeZone.number}><b>{zoneLabel(uf,town,activeZone.number)} · {selectedName}</b>{zoneNeighborhood(uf,town,activeZone.number)&&<span>{Number(activeZone.number)}ª zona · bairro de referência</span>}{activeZone.progress?<><span>{percent(activeZone.progress.percentageCounted)}% das seções</span>{activeZone.candidates.slice(0,2).map(c=><span key={c.id}><i style={{background:candidateColor(c)}}/>{c.ballotName}<b>{percent(c.percentage)}%</b></span>)}<span>Diferença: {percent((activeZone.candidates[0]?.percentage??0)-(activeZone.candidates[1]?.percentage??0))} p.p.</span><span>{number(activeZone.progress.eligibleVoters)} eleitores aptos</span></>:<span>Resultado desta zona ainda não recebido.</span>}<small>Limites territoriais e comparação 2022 não disponíveis.</small></div>}
    {municipal&&<span className="map-coverage">{displayed.filter(s=>!!lookup(s)).length} de {displayed.length} municípios com resultado recebido · demais áreas neutras</span>}
    {mode==='candidate'&&theme&&<div className="map-candidate-legend"><b>{editorialName(candidateRegistry.find(c=>c.number===candidate)?.ballotName??'Candidato')} · intensidade do voto</b><small>À frente em {metrics.filter(m=>m.candidates[0]?.number===candidate&&m.candidates[0].votes>(m.candidates[1]?.votes??0)).length} municípios entre {metrics.length} resultados recebidos</small><div>{[0,25,50,75,100].map(value=><i key={value} style={{background:mapFill('candidate',{counted:100,candidates:[{number:candidate,name:'',percentage:value,votes:1,color:candidateRegistry.find(c=>c.number===candidate)?candidateColor(candidateRegistry.find(c=>c.number===candidate)!):'#64748B'}]},candidate,theme)}}/>)}</div><span>{[0,25,50,75,100].map(value=><small key={value}>{value}%</small>)}</span></div>}
    {error&&<p className="map-error">{error}</p>}
    <div className="map-attribution">IBGE · TSE · {municipal?'Municípios':'Estados'}</div>
    <span className="map-detail-status">{level==='local'?'Detalhe local':level==='regional'?'Detalhe regional':'Visão nacional'}{municipal&&<small> · {displayed.length} áreas visíveis</small>}</span>
  </div>;
});

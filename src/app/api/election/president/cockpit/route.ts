import { snapshotResponse } from '@/lib/tse/snapshot-response';
import { cockpitHistory } from '@/lib/tse/cockpit-history';
import { knownMunicipalities } from '@/lib/tse/municipal-map';
import { president } from '@/lib/tse/service';
import { electionMap } from '@/lib/tse/map-service';
import { withAccess } from '@/lib/access/guard';
export const dynamic='force-dynamic';
export const maxDuration=60;
async function get(request:Request){
  const params=new URL(request.url).searchParams;const id=params.get('frame');
  if([...params.keys()].some(k=>k!=='frame')||(id&&!/^[a-f0-9]{20}$/.test(id)))return Response.json({error:'Momento inválido'},{status:400});
  if(!id){const [national,map]=await Promise.all([president({}),electionMap()]);await cockpitHistory.record(national,map.snapshot,knownMunicipalities());}
  const frames=await cockpitHistory.read();
  const frame=id?frames.find(f=>f.id===id):frames.at(-1);
  if(id&&!frame)return Response.json({error:'Momento não disponível nesta instância'},{status:404});
  const payload={frame:frame??null,timeline:frames.map(f=>({id:f.id,observedAt:f.observedAt,officialAt:f.national.snapshot?.progress.totaledAt??f.national.snapshot?.progress.generatedAt,counted:f.national.snapshot?.progress.percentageCounted,sections:f.national.snapshot?.progress.countedSections,candidates:f.national.analysis?.candidates??[]})),durable:cockpitHistory.durable,temporary:!!process.env.VERCEL};
  return snapshotResponse(request,payload);
}
export const GET = withAccess(get);

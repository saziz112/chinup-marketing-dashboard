const PIT=process.env.GHL_PIT_KENNESAW, LOC=process.env.GHL_LOCATION_ID_KENNESAW;
const H={Authorization:`Bearer ${PIT}`,Version:'2021-07-28',Accept:'application/json'};
const pl=await (await fetch(`https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${LOC}`,{headers:H})).json();
for(const p of (pl.pipelines||[])) console.log('PIPELINE:',p.name,'| stages:',(p.stages||[]).map(s=>s.name).join(' → '));
const pid=(pl.pipelines||[])[0]?.id; if(!pid){console.log('no pipeline');process.exit(0);}
const stageName=Object.fromEntries((pl.pipelines[0].stages||[]).map(s=>[s.id,s.name]));

let page=1,all=[],more=true;
while(more&&page<=6){
  const u=`https://services.leadconnectorhq.com/opportunities/search?location_id=${LOC}&pipeline_id=${pid}&limit=100&page=${page}`;
  const j=await (await fetch(u,{headers:H})).json();
  const os=j.opportunities||[]; all.push(...os); more=os.length===100; page++;
}
console.log('\nfetched opportunities:',all.length);
const now=Date.now(), agg={};
for(const o of all){
  const s=stageName[o.pipelineStageId]||o.pipelineStageId;
  const upd=new Date(o.updatedAt||o.dateAdded||0).getTime();
  const days=Math.floor((now-upd)/864e5);
  (agg[s]??={n:0,d:[],src:{}}); agg[s].n++; agg[s].d.push(days);
  const src=(o.source||'(none)'); agg[s].src[src]=(agg[s].src[src]||0)+1;
}
console.log('\nSTAGE                          n     median_days_since_update   top sources');
for(const [s,v] of Object.entries(agg).sort((a,z)=>z[1].n-a[1].n)){
  v.d.sort((a,b)=>a-b); const med=v.d[Math.floor(v.d.length/2)];
  const top=Object.entries(v.src).sort((a,z)=>z[1]-a[1]).slice(0,3).map(([k,n])=>`${k}:${n}`).join(', ');
  console.log(` ${s.slice(0,28).padEnd(28)} ${String(v.n).padStart(4)}   ${String(med).padStart(6)}d              ${top}`);
}
process.exit(0);

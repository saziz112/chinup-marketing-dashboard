// READ-ONLY: what does native attribution say about contacts whose `source` is blank?
const LOCS=[['DECATUR',process.env.GHL_PIT_DECATUR,process.env.GHL_LOCATION_ID_DECATUR],
            ['KENNESAW',process.env.GHL_PIT_KENNESAW,process.env.GHL_LOCATION_ID_KENNESAW],
            ['SMYRNA',process.env.GHL_PIT_SMYRNA,process.env.GHL_LOCATION_ID_SMYRNA]];
const grand={};
for(const [name,PIT,LOC] of LOCS){
  const H={Authorization:`Bearer ${PIT}`,Version:'2021-07-28',Accept:'application/json'};
  const l=await (await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${LOC}&limit=100`,{headers:H})).json();
  const blanks=(l.contacts||[]).filter(c=>!c.source||!String(c.source).trim());
  const tally={}; let n=0;
  for(const c0 of blanks.slice(0,40)){
    const r=await (await fetch(`https://services.leadconnectorhq.com/contacts/${c0.id}`,{headers:H})).json();
    const c=r.contact; if(!c) continue; n++;
    const a=c.attributionSource||{};
    let k=a.sessionSource||'(no attribution)';
    if(a.medium) k+=` / ${a.medium}`;
    tally[k]=(tally[k]||0)+1; grand[k]=(grand[k]||0)+1;
  }
  console.log(`\n${name}: ${blanks.length}/${(l.contacts||[]).length} recent contacts have blank source; resolved ${n}`);
  for(const [k,v] of Object.entries(tally).sort((a,b)=>b[1]-a[1])) console.log(`   ${String(v).padStart(3)}  ${k}`);
}
console.log('\n=== ALL LOCATIONS: what blank-source contacts really are ===');
const tot=Object.values(grand).reduce((a,b)=>a+b,0);
for(const [k,v] of Object.entries(grand).sort((a,b)=>b[1]-a[1]))
  console.log(`  ${String(v).padStart(3)}  ${String(Math.round(100*v/tot)).padStart(3)}%  ${k}`);
process.exit(0);

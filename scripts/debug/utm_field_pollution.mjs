// READ-ONLY: what do the UTM custom fields actually contain across recent contacts?
const LOCS=[['DECATUR',process.env.GHL_PIT_DECATUR,process.env.GHL_LOCATION_ID_DECATUR],
            ['KENNESAW',process.env.GHL_PIT_KENNESAW,process.env.GHL_LOCATION_ID_KENNESAW],
            ['SMYRNA',process.env.GHL_PIT_SMYRNA,process.env.GHL_LOCATION_ID_SMYRNA]];
const WANT=/^UTM (Source|Medium|Campaign|Content|Term)$/i;
for(const [name,PIT,LOC] of LOCS){
  const H={Authorization:`Bearer ${PIT}`,Version:'2021-07-28',Accept:'application/json'};
  const cf=await (await fetch(`https://services.leadconnectorhq.com/locations/${LOC}/customFields`,{headers:H})).json();
  const NAME=Object.fromEntries((cf.customFields||[]).filter(f=>WANT.test(f.name||'')).map(f=>[f.id,f.name]));
  const l=await (await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${LOC}&limit=25`,{headers:H})).json();
  const tally={}; let n=0;
  for(const {id} of (l.contacts||[])){
    const r=await (await fetch(`https://services.leadconnectorhq.com/contacts/${id}`,{headers:H})).json();
    const c=r.contact; if(!c) continue; n++;
    for(const f of (c.customFields||[])){
      const fn=NAME[f.id]; if(!fn) continue;
      const v=f.value??f.field_value; if(v===undefined||v===null||v==='') continue;
      const kind = String(v).toLowerCase()===fn.toLowerCase() ? 'SELF-LABEL'
                 : /^\{\{.*\}\}$/.test(String(v))            ? 'LITERAL-MACRO'
                 : 'real-ish';
      (tally[fn]??={})[kind]=(tally[fn][kind]||0)+1;
      if(kind==='real-ish') (tally[fn].samples??=new Set()).add(String(v).slice(0,32));
    }
  }
  console.log(`\n${name}  (n=${n} contacts)`);
  for(const [fn,t] of Object.entries(tally)){
    const s=t.samples?[...t.samples].slice(0,3).join(' | '):'';
    console.log(`  ${fn.padEnd(13)} self-label:${t['SELF-LABEL']||0}  macro:${t['LITERAL-MACRO']||0}  other:${t['real-ish']||0}  ${s}`);
  }
}
process.exit(0);

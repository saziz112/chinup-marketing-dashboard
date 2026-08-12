// READ-ONLY: which FB lead forms are actually producing leads, per location?
const LOCS=[['DECATUR',process.env.GHL_PIT_DECATUR,process.env.GHL_LOCATION_ID_DECATUR],
            ['KENNESAW',process.env.GHL_PIT_KENNESAW,process.env.GHL_LOCATION_ID_KENNESAW],
            ['SMYRNA',process.env.GHL_PIT_SMYRNA,process.env.GHL_LOCATION_ID_SMYRNA]];
const TRIGGER=new Set(['All Locations - Botox $199 Form - April 2026',
                       'DECATUR - Botox - General - Volume - June 2025- copy-copy-copy']);
for(const [name,PIT,LOC] of LOCS){
  const H={Authorization:`Bearer ${PIT}`,Version:'2021-07-28',Accept:'application/json'};
  const l=await (await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${LOC}&limit=100`,{headers:H})).json();
  const forms={}; let n=0, newest='', oldest='zzzz';
  for(const {id} of (l.contacts||[])){
    const r=await (await fetch(`https://services.leadconnectorhq.com/contacts/${id}`,{headers:H})).json();
    const c=r.contact; if(!c) continue; n++;
    const d=(c.dateAdded||'').slice(0,10); if(d>newest)newest=d; if(d&&d<oldest)oldest=d;
    for(const a of [c.lastAttributionSource, c.attributionSource]){
      const f=a?.formName; if(!f) continue;
      (forms[f]??={n:0,id:a.formId}).n++;
      break;
    }
  }
  console.log(`\n${name} — ${n} contacts sampled (${oldest} → ${newest})`);
  const rows=Object.entries(forms).sort((a,b)=>b[1].n-a[1].n);
  if(!rows.length) console.log('  (no form-attributed contacts in sample)');
  for(const [f,v] of rows)
    console.log(`  ${String(v.n).padStart(3)}  ${TRIGGER.has(f)?'IN TRIGGER ':'** MISSING '} ${f}`);
}
process.exit(0);

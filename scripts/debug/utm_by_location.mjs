const LOCS=[['DECATUR',process.env.GHL_PIT_DECATUR,process.env.GHL_LOCATION_ID_DECATUR],
            ['KENNESAW',process.env.GHL_PIT_KENNESAW,process.env.GHL_LOCATION_ID_KENNESAW],
            ['SMYRNA',process.env.GHL_PIT_SMYRNA,process.env.GHL_LOCATION_ID_SMYRNA]];
for(const [name,PIT,LOC] of LOCS){
  if(!PIT||!LOC){console.log(`${name}: missing creds`);continue;}
  const H={Authorization:`Bearer ${PIT}`,Version:'2021-07-28',Accept:'application/json'};
  const j=await (await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${LOC}&limit=40`,{headers:H})).json();
  const cs=(j.contacts||[]).filter(c=>/facebook|fb-/i.test(c.source||''));
  let ok=0,broken=0,none=0;
  for(const c of cs.slice(0,15)){
    const d=await (await fetch(`https://services.leadconnectorhq.com/contacts/${c.id}`,{headers:H})).json();
    const f=(d.contact?.customFields||[]).find(x=>x.id==='GZggomXcnWCpKEmrG1SU');
    if(!f||!f.value) none++; else String(f.value).includes('{{')?broken++:ok++;
  }
  console.log(`${name.padEnd(9)} fb_contacts_checked=${Math.min(cs.length,15)}  ad_name_ok=${ok}  BROKEN=${broken}  empty=${none}`);
}
process.exit(0);

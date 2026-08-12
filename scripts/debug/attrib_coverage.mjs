// READ-ONLY: how often is native attributionSource populated? Sample recent contacts per location.
const LOCS=[['DECATUR',process.env.GHL_PIT_DECATUR,process.env.GHL_LOCATION_ID_DECATUR],
            ['KENNESAW',process.env.GHL_PIT_KENNESAW,process.env.GHL_LOCATION_ID_KENNESAW],
            ['SMYRNA',process.env.GHL_PIT_SMYRNA,process.env.GHL_LOCATION_ID_SMYRNA]];
for(const [name,PIT,LOC] of LOCS){
  const H={Authorization:`Bearer ${PIT}`,Version:'2021-07-28',Accept:'application/json'};
  const l=await (await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${LOC}&limit=30`,{headers:H})).json();
  const ids=(l.contacts||[]).map(c=>c.id);
  let hasAttr=0,hasAdId=0,hasCampId=0,hasForm=0,n=0; const srcs={};
  for(const id of ids){
    const r=await (await fetch(`https://services.leadconnectorhq.com/contacts/${id}`,{headers:H})).json();
    const c=r.contact; if(!c) continue; n++;
    const a=c.attributionSource||{}, la=c.lastAttributionSource||{};
    if(Object.keys(a).length) hasAttr++;
    if(a.adId||la.adId) hasAdId++;
    if(a.campaignId||la.campaignId) hasCampId++;
    if(a.formName||la.formName) hasForm++;
    const s=a.sessionSource||'(none)'; srcs[s]=(srcs[s]||0)+1;
  }
  console.log(`${name.padEnd(9)} n=${n}  attribution=${hasAttr}  campaignId=${hasCampId}  adId=${hasAdId}  formName=${hasForm}`);
  console.log(`          sessionSource: ${Object.entries(srcs).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(', ')}`);
}
process.exit(0);

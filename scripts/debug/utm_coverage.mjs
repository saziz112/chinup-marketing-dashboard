const PIT=process.env.GHL_PIT_DECATUR, LOC=process.env.GHL_LOCATION_ID_DECATUR;
const H={Authorization:`Bearer ${PIT}`,Version:'2021-07-28',Accept:'application/json'};
const F={GZggomXcnWCpKEmrG1SU:'utm_content',cJqAmh6QOqRxUbPR5NR8:'utm_source',o5zGp3LHzKAqrrzQGsQZ:'utm_medium',u3h0v62IpO5nhNX1YiUi:'utm_campaign',uH4qPPYRm8gftmtAv5Hd:'fbclid'};
let after,ids=[],pages=0;
while(pages<3){
  const u=new URL('https://services.leadconnectorhq.com/contacts/');
  u.searchParams.set('locationId',LOC);u.searchParams.set('limit','100');
  if(after)u.searchParams.set('startAfterId',after);
  const j=await (await fetch(u,{headers:H})).json();
  const cs=j.contacts||[];if(!cs.length)break;
  ids.push(...cs.map(c=>({id:c.id,src:c.source,d:(c.dateAdded||'').slice(0,10)})));
  after=cs[cs.length-1].id;pages++;
}
console.log('sampled contacts:',ids.length);
const tally={};let n=0;
for(const c of ids.slice(0,120)){
  const j=await (await fetch(`https://services.leadconnectorhq.com/contacts/${c.id}`,{headers:H})).json();
  const cf=(j.contact?.customFields)||[];n++;
  const bucket=/facebook|fb-/i.test(c.src||'')?'paid-social':/google/i.test(c.src||'')?'paid-search':/website|chat|consultation form|waitlist/i.test(c.src||'')?'website':(c.src?'other':'(blank)');
  tally[bucket]??={n:0,utm_source:0,utm_content_ok:0,utm_content_broken:0,utm_campaign:0,fbclid:0};
  const t=tally[bucket];t.n++;
  for(const f of cf){const k=F[f.id];if(!k||!f.value)continue;
    if(k==='utm_source')t.utm_source++;
    if(k==='utm_campaign')t.utm_campaign++;
    if(k==='fbclid')t.fbclid++;
    if(k==='utm_content')String(f.value).includes('{{')?t.utm_content_broken++:t.utm_content_ok++;}
}
console.log('detail-fetched:',n,'\n');
for(const [b,t] of Object.entries(tally))
  console.log(`${b.padEnd(12)} n=${String(t.n).padStart(3)}  utm_source=${t.utm_source}  utm_campaign=${t.utm_campaign}  fbclid=${t.fbclid}  ad_name_ok=${t.utm_content_ok}  ad_name_BROKEN=${t.utm_content_broken}`);
process.exit(0);

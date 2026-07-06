/**
 * READ-ONLY: pull upcoming Zenoti appointments (today → +120d) directly from the
 * Zenoti API, match each to a dashboard patient by phone/email, and list who is
 * "already booked" — i.e. who the maintenance suppression currently CANNOT see.
 * No DB writes. Run: node --env-file=.env.local scripts/zenoti-future-bookings.mjs
 */
import postgres from 'postgres';
const url = process.env.SBNEW_POSTGRES_URL || process.env.POSTGRES_URL;
const sql = postgres(url, { ssl: 'require', max: 2 });
const API_KEY = process.env.ZENOTI_API_KEY;
const CENTERS = {
  Decatur: process.env.ZENOTI_CENTER_ID_DECATUR,
  Kennesaw: process.env.ZENOTI_CENTER_ID_KENNESAW,
  Vinings: process.env.ZENOTI_CENTER_ID_VININGS,
};
const BASE='https://api.zenoti.com';
const addDays=(d,n)=>{const x=new Date(d+'T00:00:00Z');const y=new Date(x.getTime()+n*864e5);return y.toISOString().slice(0,10);};
const todayISO=new Date().toISOString().slice(0,10);
const last10=s=>(s||'').replace(/\D/g,'').slice(-10);

async function zget(path){
  const r=await fetch(BASE+path,{headers:{'Authorization':`apikey ${API_KEY}`,'Accept':'application/json'}});
  if(r.status===429){await new Promise(x=>setTimeout(x,5000));return zget(path);}
  if(!r.ok){console.error(`  API ${r.status} ${path}`);return null;}
  return r.json();
}

try{
  const start=todayISO, end=addDays(todayISO,120);
  // 7-day chunks, exclusive end -> +1
  const chunks=[]; let c=start;
  while(c<end){const e=addDays(c,7)>end?end:addDays(c,7);chunks.push([c,e]);c=addDays(c,7);}
  const appts=[];
  for(const [name,cid] of Object.entries(CENTERS)){
    if(!cid){console.error('no center id for',name);continue;}
    for(const [s,e] of chunks){
      const apiEnd=addDays(e,1);
      const data=await zget(`/v1/appointments?center_id=${cid}&start_date=${s}&end_date=${apiEnd}`);
      const list=Array.isArray(data)?data:(data?.appointments||[]);
      for(const a of (list||[])) appts.push({...a,__center:name});
      await new Promise(x=>setTimeout(x,1100));
    }
  }
  // keep only truly-future (start_time date > today) with a guest
  const future=appts.filter(a=>{
    const d=(a.start_time||a.start_time_utc||'').slice(0,10);
    return d>todayISO && a.guest;
  });
  console.log(`Fetched ${appts.length} appts in window; ${future.length} are future-dated (> ${todayISO}) with a guest.\n`);

  // Build phone/email -> patient map from cache for matching
  const cache=await sql`SELECT client_id,source,first_name,last_name,
      RIGHT(regexp_replace(COALESCE(phone,''),'\D','','g'),10) AS p10,
      LOWER(TRIM(email)) AS em FROM mb_clients_cache`;
  const byPhone=new Map(), byEmail=new Map();
  for(const c of cache){ if(c.p10&&c.p10.length===10&&!byPhone.has(c.p10))byPhone.set(c.p10,c);
    if(c.em&&!byEmail.has(c.em))byEmail.set(c.em,c); }

  const seen=new Set(); const out=[];
  for(const a of future){
    const g=a.guest||{};
    const ph=last10(g.mobile?.number||g.mobile?.display_number||'');
    const em=(g.email||'').toLowerCase().trim();
    const match=(ph&&byPhone.get(ph))||(em&&byEmail.get(em))||null;
    const key=ph||em||g.id;
    if(seen.has(key))continue; seen.add(key);
    out.push({
      name:`${g.first_name||''} ${g.last_name||''}`.trim(),
      phone:g.mobile?.display_number||ph||'(none)',
      date:(a.start_time||'').slice(0,10),
      service:a.service?.name||'',
      center:a.__center,
      matched: match?`${match.first_name} ${match.last_name} [${match.source} id ${match.client_id}]`:'⚠️ NOT in dashboard (new guest)'
    });
  }
  out.sort((x,y)=>x.date.localeCompare(y.date));
  console.log(`Unique guests with an upcoming booking: ${out.length}\n`);
  for(const o of out)
    console.log(`  ${o.date}  ${o.name.padEnd(24)} ${String(o.phone).padEnd(16)} ${o.center.padEnd(9)} ${o.service}\n      → dashboard match: ${o.matched}`);
  console.log('\n(read-only — no DB writes)');
}catch(e){console.error('❌',e.message,e.stack);}
finally{await sql.end();}

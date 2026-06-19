// READ-ONLY. (1) Maintenance ≤14-day shortlist (name/phone/location) for staff.
// (2) Lapsed-* false-positive check: did anyone get a "you're lapsed" text while
//     actually having recent activity? Recency uses sale_date+appts (NOT items_json),
//     so the double-encoding bug should NOT have caused false lapsed texts — verify.
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sql = postgres(process.env.POSTGRES_URL || process.env.SBNEW_POSTGRES_URL, { ssl: 'require' });
const CAD = { Botox:80, Dysport:85, 'Lip Flip':60, 'Dermal Filler':180, Sculptra:60, HydraFacial:35, 'Chemical Peel':35, CoolPeel:150, Microneedling:40, Dermaplaning:45, Emsculpt:90, 'Laser Hair Removal':42 };
function norm(d){ if(!d) return null; const s=d.toLowerCase();
  if(/^zo[\s-]|alpharet|hydrinity|\bpads?\b|spf|broad-?spectrum|cleanser|power defense|overnight cream|skin ?care kit|\bserum\b|moisturizer|daily sheer|sunscreen|\bkit\b/.test(s))return null;
  if(/mic b12|\bb12\b/.test(s))return null;
  if(/consult|\bfee\b|\btips?\b|gratuity|\bdeposit\b|gift ?card|class ?pass|prepay|no.?show|follow.?up|cancellation/.test(s))return null;
  if(/lip ?flip/.test(s))return'Lip Flip'; if(/botox/.test(s))return'Botox'; if(/dysport/.test(s))return'Dysport';
  if(/sculptra/.test(s))return'Sculptra'; if(/restylane|juvederm|versa|\brha\b|filler|kysse|defyne|refyne|contour|\blyft\b|voluma|vollure|radiesse|profile balancing/.test(s))return'Dermal Filler';
  if(/hydra ?facial|\bhf\b|hf -/.test(s))return'HydraFacial'; if(/cool ?peel/.test(s))return'CoolPeel'; if(/chemical peel|vi peel|\bpeel\b/.test(s))return'Chemical Peel';
  if(/microneedling|skin ?pen|skinpen|rf micro|venus rf|virtue/.test(s))return'Microneedling'; if(/dermaplaning/.test(s))return'Dermaplaning';
  if(/emsculpt|emsella/.test(s))return'Emsculpt'; if(/laser hair|\bhr\b|lhr/.test(s))return'Laser Hair Removal'; return null; }
const normP=p=>{const x=(p||'').replace(/\D/g,'');return x.length===11&&x[0]==='1'?x.slice(1):x;};
const hashP=p=>createHash('sha256').update(normP(p)).digest('hex');

const clients = await sql`SELECT client_id, first_name, last_name, phone FROM mb_clients_cache WHERE phone IS NOT NULL AND phone<>''`;
const hashToClients = new Map(); const info = new Map();
for (const c of clients){ if(normP(c.phone).length<10)continue; const h=hashP(c.phone); if(!hashToClients.has(h))hashToClients.set(h,new Set()); hashToClients.get(h).add(c.client_id); info.set(c.client_id,{name:`${c.first_name||''} ${c.last_name||''}`.trim(),phone:normP(c.phone)}); }

// ---- (1) Maintenance ≤14d shortlist ----
const msends = await sql`SELECT cc.phone_hash, cc.location_key, to_char(cc.sent_at,'YYYY-MM-DD') sent_at, cc.treatment, cc.cadence_days
  FROM campaign_contacts cc JOIN campaign_runs cr ON cr.run_id=cc.run_id WHERE cr.segment='maintenance' AND cc.status='sent' AND cc.phone_hash IS NOT NULL`;
const short=[];
for(const s of msends){ const cids=hashToClients.get(s.phone_hash); if(!cids)continue;
  const rows=await sql`SELECT to_char(sale_date,'YYYY-MM-DD') d, items_json FROM mb_sales_history WHERE client_id=ANY(${[...cids]}) AND sale_date<=${s.sent_at} ORDER BY sale_date DESC`;
  let recent=null;
  for(const r of rows){ let items=r.items_json; if(typeof items==='string'){try{items=JSON.parse(items);}catch{items=[];}} if(!Array.isArray(items))continue;
    let ch=null; for(const it of items){if(it.IsService===false){const t=norm(it.Description);if(t){ch=t;break;}}} if(!ch)for(const it of items){const t=norm(it.Description);if(t){ch=t;break;}}
    if(ch){recent={t:ch,d:r.d};break;} }
  if(!recent)continue; const days=Math.floor((new Date(s.sent_at)-new Date(recent.d))/86400000);
  if(days < (CAD[recent.t]??9999) && days<=14){ const ci=[...cids].map(c=>info.get(c)).find(Boolean)||{name:'?',phone:'?'};
    short.push({name:ci.name,phone:ci.phone,loc:s.location_key,sent:s.sent_at,trueLast:`${recent.t} ${recent.d}`,days}); }
}
short.sort((a,b)=>a.days-b.days);
console.log(`=== (1) MAINTENANCE ≤14-day shortlist — ${short.length} patients (staff touch if recognized) ===`);
for(const f of short) console.log(`  ${f.name.padEnd(22)} ${f.phone}  ${f.loc.padEnd(9)} texted ${f.sent} | really in ${f.trueLast} (${f.days}d before)`);

// ---- (2) Lapsed false-positive audit ----
const MIN={'lapsed-vip':120,'lapsed-long':180,'lapsed-winback':365};
const lsends = await sql`SELECT cr.segment, cc.phone_hash, to_char(cc.sent_at,'YYYY-MM-DD') sent_at
  FROM campaign_contacts cc JOIN campaign_runs cr ON cr.run_id=cc.run_id
  WHERE cr.segment IN ('lapsed-vip','lapsed-long','lapsed-winback') AND cc.status='sent' AND cc.phone_hash IS NOT NULL AND cc.sent_at >= '2026-04-19'`;
let lfp=[];
for(const s of lsends){ const cids=hashToClients.get(s.phone_hash); if(!cids)continue;
  // true most-recent ACTIVITY (sales + completed/arrived appts) as of send — matches getLapsedPatientsFromDB
  const a=await sql`SELECT max(d) md FROM (
      SELECT max(sale_date) d FROM mb_sales_history WHERE client_id=ANY(${[...cids]}) AND sale_date<=${s.sent_at}
      UNION ALL SELECT max(start_date) d FROM mb_appointments_history WHERE client_id=ANY(${[...cids]}) AND status IN ('Completed','Arrived') AND start_date<=${s.sent_at}
    ) x`;
  if(!a[0].md)continue; const days=Math.floor((new Date(s.sent_at)-new Date(a[0].md))/86400000);
  if(days < MIN[s.segment]){ const ci=[...cids].map(c=>info.get(c)).find(Boolean)||{name:'?'}; lfp.push({seg:s.segment,name:ci.name,sent:s.sent_at,days,min:MIN[s.segment]}); }
}
console.log(`\n=== (2) LAPSED false-positives (texted "lapsed" but had activity inside threshold) ===`);
console.log(`Checked ${lsends.length} lapsed sends (after 2026-04-19). False positives: ${lfp.length}`);
for(const f of lfp.sort((a,b)=>a.days-b.days)) console.log(`  ${f.seg.padEnd(15)} ${f.name.padEnd(22)} texted ${f.sent} | last activity ${f.days}d before (threshold ${f.min}d)`);
await sql.end();

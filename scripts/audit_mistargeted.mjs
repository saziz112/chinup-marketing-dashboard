// READ-ONLY audit: who got a maintenance text while a now-recovered (double-encoded)
// sale was hiding their true most-recent visit? Recomputes each SENT maintenance
// contact's real most-recent treatment AS OF send date and flags anyone who was
// actually recently treated (daysSince < cadence startDays => not "due").
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sql = postgres(process.env.POSTGRES_URL || process.env.SBNEW_POSTGRES_URL, { ssl: 'require' });

const CAD = { Botox:{s:80}, Dysport:{s:85}, 'Lip Flip':{s:60}, 'Dermal Filler':{s:180}, Sculptra:{s:60}, HydraFacial:{s:35}, 'Chemical Peel':{s:35}, CoolPeel:{s:150}, Microneedling:{s:40}, Dermaplaning:{s:45}, Emsculpt:{s:90}, 'Laser Hair Removal':{s:42} };
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

// 1) hash -> client_ids
const clients = await sql`SELECT client_id, first_name, last_name, phone FROM mb_clients_cache WHERE phone IS NOT NULL AND phone<>''`;
const hashToClients = new Map();
const nameOf = new Map();
for (const c of clients){ const h=hashP(c.phone); if(normP(c.phone).length<10)continue; if(!hashToClients.has(h))hashToClients.set(h,new Set()); hashToClients.get(h).add(c.client_id); nameOf.set(c.client_id, `${c.first_name||''} ${c.last_name||''}`.trim()); }

// 2) maintenance sends
const sends = await sql`
  SELECT cc.phone_hash, to_char(cc.sent_at,'YYYY-MM-DD') sent_at, cc.treatment, cc.cadence_days
  FROM campaign_contacts cc JOIN campaign_runs cr ON cr.run_id=cc.run_id
  WHERE cr.segment='maintenance' AND cc.status='sent' AND cc.phone_hash IS NOT NULL`;

// 3) for each send, recompute true most-recent treatment as of send date
const flagged = [];
for (const s of sends){
  const cids = hashToClients.get(s.phone_hash); if(!cids) continue;
  const sentMs = new Date(s.sent_at).getTime();
  const rows = await sql`SELECT to_char(sale_date,'YYYY-MM-DD') d, items_json FROM mb_sales_history WHERE client_id = ANY(${[...cids]}) AND sale_date <= ${s.sent_at} ORDER BY sale_date DESC`;
  let recent=null;
  for(const r of rows){ let items=r.items_json; if(typeof items==='string'){try{items=JSON.parse(items);}catch{items=[];}} if(!Array.isArray(items))continue;
    let chosen=null; for(const it of items){ if(it.IsService===false){const t=norm(it.Description); if(t){chosen=t;break;}} }
    if(!chosen)for(const it of items){const t=norm(it.Description); if(t){chosen=t;break;}}
    if(chosen){ recent={t:chosen,d:r.d}; break; } }
  if(!recent) continue;
  const daysAtSend = Math.floor((sentMs - new Date(recent.d).getTime())/86400000);
  const start = (CAD[recent.t]||{}).s ?? 9999;
  if(daysAtSend < start){ // recently treated -> should NOT have been "due"
    flagged.push({ name:[...cids].map(c=>nameOf.get(c)).find(Boolean)||'?', client:[...cids][0], sent:s.sent_at, textedAs:`${s.treatment} (${s.cadence_days}d)`, trueLast:`${recent.t} ${recent.d}`, trueDays:daysAtSend });
  }
}
flagged.sort((a,b)=>a.trueDays-b.trueDays);
console.log(`MAINTENANCE sends checked: ${sends.length}`);
console.log(`Mis-targeted (texted "due" but actually treated within cadence start): ${flagged.length}`);
const b=[0,0,0,0]; for(const f of flagged){ if(f.trueDays<=7)b[0]++; else if(f.trueDays<=14)b[1]++; else if(f.trueDays<=30)b[2]++; else b[3]++; }
console.log(`  treated ≤7d before text:  ${b[0]}`);
console.log(`  treated 8–14d before:     ${b[1]}`);
console.log(`  treated 15–30d before:    ${b[2]}`);
console.log(`  treated 31+d before:      ${b[3]}\n`);
if(process.argv.includes('--list')) for(const f of flagged) console.log(`  ${f.name.padEnd(22)} sent ${f.sent} as ${f.textedAs.padEnd(18)} | true last: ${f.trueLast} (${f.trueDays}d ago at send)`);
await sql.end();

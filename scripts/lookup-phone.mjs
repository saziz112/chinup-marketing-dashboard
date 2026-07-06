import postgres from 'postgres';
const url = process.env.SBNEW_POSTGRES_URL || process.env.POSTGRES_URL;
const sql = postgres(url, { ssl: 'require', max: 2 });
const RAW = process.argv[2] || '';
const p10 = RAW.replace(/\D/g,'').slice(-10);
try {
  const clients = await sql`
    SELECT client_id, source, first_name, last_name, email, phone,
           to_char(creation_date,'YYYY-MM-DD') AS created
    FROM mb_clients_cache
    WHERE RIGHT(regexp_replace(COALESCE(phone,''),'\D','','g'),10) = ${p10}
    ORDER BY source, created`;
  console.log(`Clients with phone ...${p10} (${clients.length}):`);
  for (const c of clients)
    console.log(`  [${c.source}] id=${c.client_id}  ${c.first_name} ${c.last_name}  ${c.email||'(no email)'}  ${c.phone}  created ${c.created}`);
  if (!clients.length) { process.exit(0); }
  const ids = clients.map(c=>c.client_id);
  // also pull anyone sharing their email (cross-record identity)
  const emails = [...new Set(clients.map(c=>(c.email||'').toLowerCase().trim()).filter(Boolean))];
  let extra = [];
  if (emails.length) {
    extra = await sql`
      SELECT client_id, source, first_name, last_name, email, phone FROM mb_clients_cache
      WHERE LOWER(TRIM(email)) = ANY(${emails}) AND NOT (client_id = ANY(${ids}))`;
    for (const c of extra) { console.log(`  [${c.source}] id=${c.client_id}  ${c.first_name} ${c.last_name}  (matched by EMAIL ${c.email}) ${c.phone}`); ids.push(c.client_id); }
  }

  console.log(`\n--- SALES (all sources, all matched ids) ---`);
  const sales = await sql`
    SELECT client_id, source, to_char(sale_date,'YYYY-MM-DD') AS d, items_json
    FROM mb_sales_history WHERE client_id = ANY(${ids}) ORDER BY sale_date`;
  for (const s of sales) {
    let items = s.items_json; if (typeof items==='string'){try{items=JSON.parse(items)}catch{items=[]}}
    const desc = (Array.isArray(items)?items:[]).map(i=>i?.Description||i?.description).filter(Boolean).join(', ');
    console.log(`  ${s.d} [${s.source}] (id ${s.client_id})  ${desc}`);
  }
  console.log(`\n--- APPOINTMENTS (all sources) ---`);
  const appts = await sql`
    SELECT client_id, source, to_char(start_date,'YYYY-MM-DD') AS d, status
    FROM mb_appointments_history WHERE client_id = ANY(${ids}) ORDER BY start_date`;
  for (const a of appts) console.log(`  ${a.d} [${a.source}] ${a.status} (id ${a.client_id})`);
} catch (e) { console.error('❌', e.message); }
finally { await sql.end(); }

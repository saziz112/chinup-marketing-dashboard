import postgres from 'postgres';
const url = process.env.SBNEW_POSTGRES_URL || process.env.POSTGRES_URL;
const sql = postgres(url, { ssl: 'require', max: 2 });
const NAME = process.argv[2] || 'Christiyana';
try {
  const clients = await sql`
    SELECT client_id, source, first_name, last_name, email, phone,
           to_char(creation_date,'YYYY-MM-DD') AS created
    FROM mb_clients_cache
    WHERE first_name ILIKE ${'%'+NAME+'%'} OR last_name ILIKE ${'%'+NAME+'%'}
    ORDER BY last_name, source`;
  console.log(`Matching clients (${clients.length}):`);
  for (const c of clients) {
    console.log(`  [${c.source}] id=${c.client_id}  ${c.first_name} ${c.last_name}  ${c.email||'(no email)'}  ${c.phone||'(no phone)'}  created ${c.created}`);
  }
  if (!clients.length) { console.log('none'); process.exit(0); }
  const ids = clients.map(c=>c.client_id);

  console.log(`\n--- SALES (all sources) ---`);
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
    SELECT client_id, source, to_char(start_date,'YYYY-MM-DD') AS d, status, service_name
    FROM mb_appointments_history WHERE client_id = ANY(${ids}) ORDER BY start_date`;
  for (const a of appts) console.log(`  ${a.d} [${a.source}] ${a.status}  ${a.service_name||''} (id ${a.client_id})`);
} catch (e) { console.error('❌', e.message); }
finally { await sql.end(); }

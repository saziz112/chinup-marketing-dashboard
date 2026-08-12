// READ-ONLY recon for lead-source tracking (PLAN item 22).
import { createPool } from '@vercel/postgres';
const p = createPool({ connectionString: process.env.SBNEW_POSTGRES_URL });

const cols = await p.query(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name='ghl_contacts_map' ORDER BY ordinal_position`);
console.log('ghl_contacts_map columns:', cols.rows.map(c => `${c.column_name}:${c.data_type}`).join(', '));

const total = await p.query(`SELECT count(*) n FROM ghl_contacts_map`);
console.log('total GHL contacts:', total.rows[0].n);

const hasSource = cols.rows.some(c => c.column_name === 'source');
if (hasSource) {
    const src = await p.query(`
      SELECT COALESCE(NULLIF(TRIM(source),''),'(blank)') src, count(*) n,
             min(created_at)::date first_seen, max(created_at)::date last_seen
      FROM ghl_contacts_map GROUP BY 1 ORDER BY n DESC LIMIT 40`);
    console.log('\nSOURCE VALUES:');
    for (const r of src.rows) console.log(` ${String(r.n).padStart(6)}  ${String(r.src).slice(0,45).padEnd(45)} ${r.first_seen} → ${r.last_seen}`);

    const recent = await p.query(`
      SELECT COALESCE(NULLIF(TRIM(source),''),'(blank)') src, count(*) n
      FROM ghl_contacts_map WHERE created_at >= NOW() - INTERVAL '90 days'
      GROUP BY 1 ORDER BY n DESC LIMIT 25`);
    console.log('\nSOURCE VALUES — last 90 days only:');
    for (const r of recent.rows) console.log(` ${String(r.n).padStart(6)}  ${r.src}`);
}

const leads = await p.query(`SELECT count(*) n FROM leads`).catch(() => ({ rows: [{ n: 'n/a' }] }));
console.log('\nleads table rows:', leads.rows[0].n);
const lcols = await p.query(`
  SELECT column_name FROM information_schema.columns WHERE table_name='leads' ORDER BY ordinal_position`);
console.log('leads columns:', lcols.rows.map(c => c.column_name).join(', '));
process.exit(0);

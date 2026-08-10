// READ-ONLY recon for the campaign scoreboard (PLAN item 21).
import { createPool } from '@vercel/postgres';
const p = createPool({ connectionString: process.env.SBNEW_POSTGRES_URL });

const tables = await p.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' ORDER BY table_name`);
console.log('TABLES:', tables.rows.map(r => r.table_name).join(', '));

const runs = await p.query(`
  SELECT segment, count(*) runs, min(run_at)::date first_run, max(run_at)::date last_run,
         sum(total_sent) sent, sum(total_targeted) targeted
  FROM campaign_runs GROUP BY 1 ORDER BY sum(total_sent) DESC`);
console.log('\nRUNS BY SEGMENT:');
for (const r of runs.rows) console.log(` ${String(r.segment).padEnd(22)} runs=${String(r.runs).padStart(3)} sent=${String(r.sent).padStart(5)} targeted=${String(r.targeted).padStart(5)}  ${r.first_run} → ${r.last_run}`);

const cc = await p.query(`
  SELECT r.segment, cc.status, cc.holdout, cc.channel, count(*) n,
         count(DISTINCT cc.contact_id) patients
  FROM campaign_contacts cc JOIN campaign_runs r ON r.run_id=cc.run_id
  GROUP BY 1,2,3,4 ORDER BY 1,2,3`);
console.log('\nCONTACT ROWS (rows vs distinct patients):');
for (const r of cc.rows) console.log(` ${String(r.segment).padEnd(22)} ${String(r.status).padEnd(8)} hold=${r.holdout} ${r.channel.padEnd(5)} rows=${String(r.n).padStart(5)} patients=${String(r.patients).padStart(5)}`);

const vh = await p.query(`SELECT count(*) n FROM campaign_contacts WHERE variant_id IS NOT NULL`);
console.log('\nrows with variant_id:', vh.rows[0].n);
process.exit(0);

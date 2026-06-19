#!/usr/bin/env node
// One-time backfill: repair double-encoded mb_sales_history.items_json rows.
//
// Root cause: the sync writer bound items_json with JSON.stringify(), which
// postgres.js serializes a SECOND time for a jsonb column -> a jsonb *string*
// holding "[{...}]" instead of a jsonb array. ~1,089 rows written since the
// Apr-2026 Supabase/postgres.js migration are affected. The maintenance/lapsed
// segment queries filtered `jsonb_typeof = 'array'` and silently dropped these
// rows, mis-flagging patients (e.g. Jaime Wolfe) as treatment-due.
//
// This unwraps one encoding level: (items_json #>> '{}')::jsonb. Validated
// read-only beforehand: all 1,089 string rows transform to arrays, 0 failures.
// Idempotent (only touches jsonb_typeof='string' rows) and transactional.
import postgres from 'postgres';
import { readFileSync } from 'fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const cs = process.env.POSTGRES_URL || process.env.SBNEW_POSTGRES_URL || process.env.SBNEW_POSTGRES_URL_NON_POOLING;
const sql = postgres(cs, { ssl: 'require' });

try {
  const [{ count: before }] = await sql`SELECT count(*) FROM mb_sales_history WHERE jsonb_typeof(items_json) = 'string'`;
  console.log(`Double-encoded rows before: ${before}`);

  // Safety: confirm every target row unwraps to an array before committing.
  const [{ bad }] = await sql`
    SELECT count(*) AS bad FROM mb_sales_history
    WHERE jsonb_typeof(items_json) = 'string'
      AND jsonb_typeof((items_json #>> '{}')::jsonb) <> 'array'`;
  if (Number(bad) > 0) throw new Error(`${bad} rows would NOT become arrays — aborting, no changes made.`);

  await sql.begin(async (tx) => {
    const res = await tx`
      UPDATE mb_sales_history
      SET items_json = (items_json #>> '{}')::jsonb
      WHERE jsonb_typeof(items_json) = 'string'`;
    console.log(`Rows updated: ${res.count}`);
  });

  const [{ count: after }] = await sql`SELECT count(*) FROM mb_sales_history WHERE jsonb_typeof(items_json) = 'string'`;
  console.log(`Double-encoded rows after: ${after}`);
  console.log(after === '0' ? '✅ Backfill complete — all rows are proper jsonb arrays.' : '⚠️  Some string rows remain — investigate.');
} catch (e) {
  console.error('❌ Backfill failed (transaction rolled back):', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}

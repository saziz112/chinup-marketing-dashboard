/** Which report channel do Emsculpt-tagged contacts land in? Read-only. */
import { sql } from '@/lib/db/sql';
import { resolveChannel } from '@/lib/attribution';

async function main() {
  const r = await sql<{
    source: string | null; attribution_source: Record<string, unknown> | null; tags: unknown;
  }>`
    SELECT source, attribution_source, tags
      FROM ghl_contacts_map
     WHERE created_at >= '2026-02-13' AND created_at < '2026-07-14'
       AND (tags)::text ILIKE '%emsculpt%'`;

  const byCh = new Map<string, number>();
  const tagCount = new Map<string, number>();
  for (const x of r.rows) {
    const ch = resolveChannel(x.source, x.attribution_source as never);
    byCh.set(ch, (byCh.get(ch) ?? 0) + 1);
    let t: unknown = x.tags;
    if (typeof t === 'string') { try { t = JSON.parse(t); } catch { t = []; } }
    for (const tag of Array.isArray(t) ? t : []) {
      if (typeof tag === 'string' && /emsculpt/i.test(tag)) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
    }
  }
  console.log(`Emsculpt-tagged contacts in window: ${r.rows.length}\n\nby report channel:`);
  for (const [k, v] of [...byCh.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(5)}  ${k}`);
  }
  console.log('\nthe emsculpt tags themselves:');
  for (const [k, v] of [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(v).padStart(5)}  ${k}`);
  }
  process.exit(0);
}
main();

/** What actually creates the "Social Media" and "Other" contacts? */
import { sql } from '@/lib/db/sql';
import { resolveChannel } from '@/lib/attribution';

function tagList(raw: unknown): string[] {
  if (!raw) return [];
  let v: unknown = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}

async function main() {
  const r = await sql<{
    contact_id: string; location_key: string; source: string | null;
    attribution_source: Record<string, unknown> | null; tags: unknown;
    email: string | null; phone_normalized: string | null;
    contact_name: string | null; created_at: Date;
  }>`
    SELECT DISTINCT ON (COALESCE(NULLIF(phone_normalized,''), NULLIF(email,''), contact_id))
           contact_id, location_key, source, attribution_source, tags,
           email, phone_normalized, contact_name, created_at
      FROM ghl_contacts_map
     WHERE created_at <  now() - interval '30 days'
       AND created_at >= now() - interval '180 days'
     ORDER BY COALESCE(NULLIF(phone_normalized,''), NULLIF(email,''), contact_id), created_at ASC`;

  for (const target of ['Social Media', 'Other'] as const) {
    const rows = r.rows.filter((x) => resolveChannel(x.source, x.attribution_source as never) === target);
    console.log(`\n${'='.repeat(64)}\n${target.toUpperCase()} — ${rows.length} contacts\n${'='.repeat(64)}`);

    const tags = new Map<string, number>();
    const locs = new Map<string, number>();
    const hours = new Map<number, number>();
    const dows = new Map<number, number>();
    let noTags = 0, noName = 0;
    const attrKeys = new Map<string, number>();

    for (const x of rows) {
      const t = tagList(x.tags);
      if (!t.length) noTags++;
      for (const tag of t) tags.set(tag, (tags.get(tag) ?? 0) + 1);
      locs.set(x.location_key, (locs.get(x.location_key) ?? 0) + 1);
      const d = new Date(x.created_at);
      hours.set(d.getHours(), (hours.get(d.getHours()) ?? 0) + 1);
      dows.set(d.getDay(), (dows.get(d.getDay()) ?? 0) + 1);
      if (!x.contact_name || !x.contact_name.trim()) noName++;
      for (const [k, v] of Object.entries((x.attribution_source ?? {}) as Record<string, unknown>)) {
        if (v !== null && v !== '' && v !== undefined) attrKeys.set(k, (attrKeys.get(k) ?? 0) + 1);
      }
    }

    console.log(`\n  tags present on ${rows.length - noTags}/${rows.length}; top tags:`);
    for (const [t, n] of [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`     ${String(n).padStart(5)}  ${t}`);
    }
    console.log(`\n  by location:`, [...locs.entries()].map(([k, v]) => `${k}=${v}`).join('  '));
    console.log(`  missing a name: ${noName}/${rows.length}`);
    console.log(`  attribution fields populated:`,
      [...attrKeys.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '));

    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    console.log('  by weekday:', [...dows.entries()].sort((a, b) => a[0] - b[0])
      .map(([d, n]) => `${DOW[d]}=${n}`).join('  '));
    const businessHrs = [...hours.entries()].filter(([h]) => h >= 9 && h < 19).reduce((s, [, n]) => s + n, 0);
    console.log(`  created 9am-7pm: ${businessHrs}/${rows.length} (${((businessHrs / rows.length) * 100).toFixed(0)}%)`);

    console.log('\n  sample records:');
    for (const x of rows.slice(0, 6)) {
      console.log(`     ${x.created_at.toISOString().slice(0, 16)}  ${x.location_key.padEnd(9)}` +
        ` name=${(x.contact_name || '(none)').slice(0, 22).padEnd(22)}` +
        ` ph=${x.phone_normalized ? 'Y' : '-'} em=${x.email ? 'Y' : '-'}` +
        `  tags=[${tagList(x.tags).slice(0, 3).join(', ')}]`);
    }
  }
  process.exit(0);
}
main();

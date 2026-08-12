/** Are the "Social Media" contacts prospective patients, or inbound spam DMs? */
import { sql } from '@/lib/db/sql';
import { resolveChannel } from '@/lib/attribution';

async function main() {
  const r = await sql<{
    contact_name: string | null; source: string | null;
    attribution_source: Record<string, unknown> | null;
    phone_normalized: string | null; email: string | null;
  }>`
    SELECT DISTINCT ON (COALESCE(NULLIF(phone_normalized,''), NULLIF(email,''), contact_id))
           contact_name, source, attribution_source, phone_normalized, email
      FROM ghl_contacts_map
     WHERE created_at <  now() - interval '30 days'
       AND created_at >= now() - interval '180 days'
     ORDER BY COALESCE(NULLIF(phone_normalized,''), NULLIF(email,''), contact_id), created_at ASC`;

  const rows = r.rows.filter((x) => resolveChannel(x.source, x.attribution_source as never) === 'Social Media');

  // A personal name: 2-3 alphabetic words, no business/service vocabulary.
  const BIZ = /\b(ai|chat|support|business|marketing|agency|media|studio|solutions|services|official|store|shop|llc|inc|team|app|tech|digital|seo|leads?|growth|bot|assistant|crypto|invest|loan|design|dev|web|verified|page|help|center|centre|group|co|hq)\b/i;
  const PERSONAL = /^[a-z]+(?:[\s'-][a-z]+){1,2}$/i;

  let personal = 0, business = 0, ambiguous = 0;
  const bizExamples: string[] = [], personExamples: string[] = [];
  for (const x of rows) {
    const n = (x.contact_name || '').trim();
    if (!n) { ambiguous++; continue; }
    if (BIZ.test(n)) { business++; if (bizExamples.length < 14) bizExamples.push(n); }
    else if (PERSONAL.test(n)) { personal++; if (personExamples.length < 10) personExamples.push(n); }
    else { ambiguous++; }
  }
  const withContact = rows.filter((x) => x.phone_normalized || x.email).length;

  console.log(`Social Media contacts: ${rows.length}`);
  console.log(`  look like a person's name : ${personal} (${((personal / rows.length) * 100).toFixed(0)}%)`);
  console.log(`  look like a business/bot  : ${business} (${((business / rows.length) * 100).toFixed(0)}%)`);
  console.log(`  ambiguous / single word   : ${ambiguous} (${((ambiguous / rows.length) * 100).toFixed(0)}%)`);
  console.log(`  have ANY phone or email   : ${withContact} (${((withContact / rows.length) * 100).toFixed(0)}%)`);
  console.log('\n  business-looking examples:', bizExamples.join(' | '));
  console.log('\n  person-looking examples  :', personExamples.join(' | '));

  // Of the ones that look like real people, how many are contactable?
  const personalRows = rows.filter((x) => {
    const n = (x.contact_name || '').trim();
    return n && !BIZ.test(n) && PERSONAL.test(n);
  });
  const personalContactable = personalRows.filter((x) => x.phone_normalized || x.email).length;
  console.log(`\n  of the ${personalRows.length} person-looking contacts, ${personalContactable} have phone or email` +
    ` (${((personalContactable / Math.max(personalRows.length, 1)) * 100).toFixed(0)}%)`);
  process.exit(0);
}
main();

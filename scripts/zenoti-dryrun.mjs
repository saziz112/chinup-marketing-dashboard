/**
 * Zenoti P1 dry-run (READ-ONLY — no DB writes).
 * Fetches 7/1→today sales + appointments across all centers, applies the same
 * mapping the sync writers use, and reports:
 *   - what WOULD be inserted (sales lines, appts, distinct guests)
 *   - normalizeTreatment coverage on real Zenoti item_names (P3 gate, previewed)
 *   - how many guests come free from appointments vs. need a getZenotiGuest call
 *
 * Run: node --env-file=.env.local scripts/zenoti-dryrun.mjs
 */

const BASE = 'https://api.zenoti.com';
const CENTERS = {
  decatur: process.env.ZENOTI_CENTER_ID_DECATUR,
  kennesaw: process.env.ZENOTI_CENTER_ID_KENNESAW,
  vinings: process.env.ZENOTI_CENTER_ID_VININGS,
};
const H = { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `apikey ${process.env.ZENOTI_API_KEY}` };
const CUTOVER = '2026-07-01';
const TODAY = new Date().toISOString().slice(0, 10);

async function call(method, ep, body) {
  const r = await fetch(`${BASE}${ep}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${r.status} ${ep} — ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// --- inline copy of normalizeTreatment (mirrors src/lib/treatments.ts) is avoided;
//     instead we import the real one via a tiny regex-free dynamic import fallback. ---
async function loadNormalizeTreatment() {
  // treatments.ts is pure (no runtime deps) but is TS; try tsx-style import, else regex fallback.
  try {
    const mod = await import('../src/lib/treatments.ts');
    return mod.normalizeTreatment;
  } catch {
    return null;
  }
}

function addDays(d, n) { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }

async function main() {
  console.log(`Zenoti P1 dry-run (READ-ONLY) — ${CUTOVER} → ${TODAY}\n`);

  // Sales across all centers
  const salesRows = [];
  for (const [loc, cid] of Object.entries(CENTERS)) {
    let page = 1;
    for (;;) {
      const res = await call('POST', `/v1/reports/sales/accrual_basis/flat_file?page=${page}&size=100`, {
        center_ids: [cid], start_date: `${CUTOVER} 00:00:00`, end_date: `${TODAY} 23:59:59`,
      });
      const batch = res.sales ?? [];
      for (const r of batch) salesRows.push({ ...r, _loc: loc });
      const total = res.page_info?.total ?? batch.length;
      if (batch.length === 0 || page * 100 >= total) break;
      page++;
    }
  }
  const closed = salesRows.filter(r => r.status === 'Closed');
  console.log(`SALES: ${salesRows.length} rows, ${closed.length} Closed (would insert), ${salesRows.length - closed.length} dropped (non-Closed)`);
  console.log(`  distinct guests in sales: ${new Set(closed.map(r => r.guest_id)).size}`);
  console.log(`  $0 lines kept: ${closed.filter(r => r.collected === 0).length} (redemptions w/ real treatment names)`);
  const netRevenue = closed.reduce((s, r) => s + (r.collected || 0), 0);
  console.log(`  Σ collected (net revenue): $${netRevenue.toFixed(2)}`);

  // Appointments across all centers (end exclusive → +1)
  const appts = [];
  for (const [loc, cid] of Object.entries(CENTERS)) {
    const res = await call('GET', `/v1/appointments?center_id=${cid}&start_date=${CUTOVER}&end_date=${addDays(TODAY, 1)}`);
    for (const a of (Array.isArray(res) ? res : [])) appts.push({ ...a, _loc: loc });
  }
  const STATUS = { '-2': 'NoShow', '-1': 'Cancelled', '0': 'Booked', '1': 'Completed', '4': 'Confirmed', '10': null };
  const mapped = appts.map(a => ({ ...a, _mb: STATUS[String(a.status)] })).filter(a => a._mb && a.guest?.id);
  const hist = {};
  for (const a of mapped) hist[a._mb] = (hist[a._mb] || 0) + 1;
  console.log(`\nAPPTS: ${appts.length} raw, ${mapped.length} would insert (blockouts/guestless dropped)`);
  console.log(`  status histogram: ${JSON.stringify(hist)}`);
  const apptGuests = new Set(mapped.map(a => a.guest.id));
  console.log(`  guests harvestable FREE from appts: ${apptGuests.size}`);

  // Guests in sales but NOT in appointments → need getZenotiGuest fallback
  const salesGuests = new Set(closed.map(r => r.guest_id));
  const needFetch = [...salesGuests].filter(g => !apptGuests.has(g));
  console.log(`  sales-only guests needing getZenotiGuest fallback: ${needFetch.length}`);

  // normalizeTreatment coverage (P3 gate preview)
  console.log(`\nNORMALIZE-TREATMENT COVERAGE (P3 gate preview):`);
  const normalize = await loadNormalizeTreatment();
  if (!normalize) {
    console.log('  ⚠️ could not import treatments.ts under plain node (needs tsx). Distinct item_names below for manual check:');
    const names = [...new Set(closed.map(r => r.item_name))].sort();
    names.forEach(n => console.log(`    · ${n}`));
    return;
  }
  const byName = new Map();
  for (const r of closed) {
    if (!byName.has(r.item_name)) byName.set(r.item_name, { type: r.item_type, cat: r.item_category, t: normalize(r.item_name) });
  }
  const classified = [...byName.entries()].filter(([, v]) => v.t);
  const dropped = [...byName.entries()].filter(([, v]) => !v.t);
  console.log(`  ${classified.length}/${byName.size} distinct item_names classify to a treatment:`);
  for (const [n, v] of classified) console.log(`    ✓ ${v.t.padEnd(20)} ← "${n}" [${v.type}/${v.cat}]`);
  console.log(`  ${dropped.length} fall through (retail/fees/packages/OR a missed treatment — REVIEW injectables/services):`);
  for (const [n, v] of dropped) {
    const flag = (v.cat === 'Injectables' || v.type === 'Service') ? ' ⚠️REVIEW' : '';
    console.log(`    · "${n}" [${v.type}/${v.cat}]${flag}`);
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });

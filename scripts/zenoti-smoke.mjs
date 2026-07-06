/**
 * Zenoti P0 smoke test (marketing dashboard).
 * Verifies the ported read-only client can (1) list centers, (2) pull a small
 * window of 7/1 sales rows, (3) pull a small window of appointments — against
 * all three configured centers. Read-only; no DB writes.
 *
 * Run: node --env-file=.env.local scripts/zenoti-smoke.mjs
 *
 * Re-implements the client's fetch inline (plain fetch, no @/ alias / trackCall)
 * so it runs without the Next build. Kept deliberately thin — it mirrors
 * src/lib/integrations/zenoti.ts, it is not that module.
 */

const BASE_URL = 'https://api.zenoti.com';

const CENTERS = {
  decatur: process.env.ZENOTI_CENTER_ID_DECATUR,
  kennesaw: process.env.ZENOTI_CENTER_ID_KENNESAW,
  vinings: process.env.ZENOTI_CENTER_ID_VININGS,
};

function assertEnv() {
  const missing = ['ZENOTI_API_KEY', 'ZENOTI_CENTER_ID_DECATUR', 'ZENOTI_CENTER_ID_KENNESAW', 'ZENOTI_CENTER_ID_VININGS']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('❌ Missing env vars:', missing.join(', '));
    process.exit(1);
  }
}

async function zenotiCall(method, endpoint, body) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `apikey ${process.env.ZENOTI_API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${res.status} ${endpoint} — ${txt.slice(0, 300)}`);
  }
  return res.json();
}

async function main() {
  assertEnv();
  console.log('Zenoti P0 smoke test — marketing dashboard\n');

  // 1. Centers
  console.log('1) GET /v1/centers');
  const centersResp = await zenotiCall('GET', '/v1/centers');
  const centers = centersResp.centers || [];
  console.log(`   ✓ ${centers.length} centers returned by API`);
  for (const [loc, id] of Object.entries(CENTERS)) {
    const hit = centers.find((c) => c.id === id);
    console.log(`   ${hit ? '✓' : '✗'} ${loc.padEnd(9)} ${id} ${hit ? '→ ' + hit.name : '(NOT in /v1/centers response!)'}`);
  }

  // 2. Sales flat-file, tiny window (7/1 only), Decatur
  console.log('\n2) POST /v1/reports/sales/accrual_basis/flat_file (2026-07-01, decatur)');
  const sales = await zenotiCall('POST', '/v1/reports/sales/accrual_basis/flat_file?page=1&size=100', {
    center_ids: [CENTERS.decatur],
    start_date: '2026-07-01 00:00:00',
    end_date: '2026-07-01 23:59:59',
  });
  const rows = sales.sales || [];
  console.log(`   ✓ ${rows.length} sales rows`);
  if (rows.length) {
    const r = rows[0];
    console.log(`   sample: item_name=${JSON.stringify(r.item_name)} type=${r.item_type} cat=${JSON.stringify(r.item_category)} collected=${r.collected} status=${r.status} guest_id=${r.guest_id?.slice(0, 8)}…`);
    // Distinct item names — feeds P3 normalizeTreatment coverage check
    const names = [...new Set(rows.map((x) => x.item_name))].slice(0, 15);
    console.log(`   distinct item_names (up to 15): ${JSON.stringify(names)}`);
  }

  // 3. Appointments, tiny window (7/1), Decatur
  console.log('\n3) GET /v1/appointments (2026-07-01, decatur)');
  const appts = await zenotiCall('GET', `/v1/appointments?center_id=${CENTERS.decatur}&start_date=2026-07-01&end_date=2026-07-01`);
  const list = Array.isArray(appts) ? appts : (appts.appointments || []);
  console.log(`   ✓ ${list.length} appointments`);
  if (list.length) {
    const statuses = {};
    for (const a of list) statuses[a.status] = (statuses[a.status] || 0) + 1;
    console.log(`   status histogram: ${JSON.stringify(statuses)}`);
    const a = list.find((x) => x.guest) || list[0];
    console.log(`   sample: status=${a.status} service=${JSON.stringify(a.service?.name)} guest=${a.guest ? a.guest.id?.slice(0, 8) + '…' : 'null'} start=${a.start_time}`);
  }

  console.log('\n✅ Smoke test complete.');
}

main().catch((e) => {
  console.error('\n❌ Smoke test failed:', e.message);
  process.exit(1);
});

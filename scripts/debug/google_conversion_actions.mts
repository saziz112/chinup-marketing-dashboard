/**
 * What ARE the 193 Google Ads "conversions"? Breaks them down by conversion
 * action + category, to test whether they're phone calls (which would land in
 * the CRM as untagged inbound calls, not as Paid Search leads). Read-only.
 */
const since = process.argv[2];
const until = process.argv[3];

async function token(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).access_token;
}

async function query(q: string): Promise<any[]> {
  const res = await fetch(
    `https://googleads.googleapis.com/v23/customers/${process.env.GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await token()}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: q }),
    },
  );
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).results || [];
}

async function main() {
  const rows = await query(`
    SELECT segments.conversion_action_name,
           segments.conversion_action_category,
           metrics.all_conversions,
           metrics.conversions
      FROM campaign
     WHERE segments.date BETWEEN '${since}' AND '${until}'`);

  const agg = new Map<string, { conv: number; all: number }>();
  for (const r of rows) {
    const k = `${r.segments.conversionActionCategory}  ::  ${r.segments.conversionActionName}`;
    if (!agg.has(k)) agg.set(k, { conv: 0, all: 0 });
    const a = agg.get(k)!;
    a.conv += Number(r.metrics?.conversions || 0);
    a.all += Number(r.metrics?.allConversions || 0);
  }

  console.log(`${since} .. ${until}\n`);
  console.log('  conv   all   conversion action');
  let tc = 0, ta = 0;
  for (const [k, v] of [...agg.entries()].sort((a, b) => b[1].conv - a[1].conv)) {
    console.log(`${v.conv.toFixed(0).padStart(6)}${v.all.toFixed(0).padStart(6)}   ${k}`);
    tc += v.conv; ta += v.all;
  }
  console.log(`${tc.toFixed(0).padStart(6)}${ta.toFixed(0).padStart(6)}   TOTAL`);
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 900)); process.exit(1); });

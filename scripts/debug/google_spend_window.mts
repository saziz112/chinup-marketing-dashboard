/**
 * Actual Google Ads spend over the lead-source report window
 * (leads created 30-180 days ago), to size the "21 leads" question.
 * Read-only.
 */
import { getGoogleAdsData, isGoogleAdsConfigured } from '@/lib/integrations/google-ads';

const since = process.argv[2];
const until = process.argv[3];

async function main() {
  if (!isGoogleAdsConfigured()) {
    console.log('Google Ads NOT configured in this environment — no credentials.');
    process.exit(1);
  }
  const d = await getGoogleAdsData(since, until);
  console.log(`window ${since} .. ${until}   mock=${d.isMock}`);
  console.log(`account: ${d.account.name} (${d.account.id}) ${d.account.currency}`);
  console.log(`\nTOTAL spend      $${d.account.totalSpend.toFixed(2)}`);
  console.log(`      impressions ${d.account.totalImpressions.toLocaleString()}`);
  console.log(`      clicks      ${d.account.totalClicks.toLocaleString()}`);
  console.log(`      conversions ${d.account.totalResults}`);

  const active = d.campaigns.filter((c) => c.spend > 0).sort((a, b) => b.spend - a.spend);
  console.log(`\ncampaigns with spend: ${active.length} of ${d.campaigns.length}`);
  for (const c of active) {
    console.log(
      `  ${('$' + c.spend.toFixed(0)).padStart(9)}  ${String(c.clicks).padStart(6)} clk  ` +
      `${c.results.toFixed(1).padStart(6)} conv  ${c.status.padEnd(8)} ${c.name.slice(0, 48)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e?.message || e); process.exit(1); });

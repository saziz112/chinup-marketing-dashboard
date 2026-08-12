/** Meta Ads spend over the same lead-source report window, for comparison. Read-only. */
import { getMetaAdsData, isMetaAdsConfigured } from '@/lib/integrations/meta-ads';

const since = process.argv[2];
const until = process.argv[3];

async function main() {
  if (!isMetaAdsConfigured()) { console.log('Meta Ads NOT configured here.'); process.exit(1); }
  const d: any = await getMetaAdsData(since, until);
  console.log(`window ${since} .. ${until}`);
  console.log(JSON.stringify(d.account ?? d, null, 2).slice(0, 1200));
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 600)); process.exit(1); });

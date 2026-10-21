// Read-only: how Google processed the offline conversion uploads. Looks up each
// Data Manager request id stored on google_offline_uploads (response_error =
// 'requestId <id>') and prints its status plus error/warning counts per reason.
// Google says to wait ~30 min after a send; processing can take up to 24h.
// Run: npx tsx --env-file=.env.local scripts/debug/offline_request_status.mts
import { sql } from '../../src/lib/db/sql';

const { rows } = await sql<{ request_id: string; visits: number; sent_at: string }>`
    SELECT substring(response_error FROM 'requestId (.+)') AS request_id,
           COUNT(*)::int AS visits, MAX(uploaded_at)::text AS sent_at
      FROM google_offline_uploads
     WHERE response_status = 'sent' AND response_error LIKE 'requestId %'
     GROUP BY 1 ORDER BY 3 DESC LIMIT 10`;
if (!rows.length) { console.log('No sent requests yet.'); process.exit(0); }

const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
        client_id: process.env.GOOGLE_ADS_CLIENT_ID!, client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!, grant_type: 'refresh_token',
    }).toString(),
});
const { access_token } = await tokenRes.json();

for (const r of rows) {
    const res = await fetch(
        `https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=${encodeURIComponent(r.request_id)}`,
        { headers: { Authorization: `Bearer ${access_token}` } },
    );
    const body = await res.json();
    console.log(`\n${r.request_id}  (${r.visits} visits, sent ${r.sent_at})  HTTP ${res.status}`);
    for (const d of body.requestStatusPerDestination ?? []) {
        console.log('  status:', d.requestStatus);
        for (const e of d.errorInfo?.errorCounts ?? []) console.log('  error  ', e.reason, e.recordCount);
        for (const w of d.warningInfo?.warningCounts ?? []) console.log('  warning', w.reason, w.recordCount);
    }
    if (!res.ok) console.log(' ', JSON.stringify(body).slice(0, 300));
}
process.exit(0);

// API Usage Tracker — in-memory + Postgres persistent tracking for monitoring
// API call counts, cache efficiency, and quota consumption across all integrations.

import { sql } from '@vercel/postgres';

type ApiName = 'mindbody' | 'meta' | 'metaAds' | 'youtube' | 'googleAds' | 'googleBusiness' | 'ghl' | 'yelp' | 'realself' | 'googleSearchConsole' | 'kieAi';

interface CallRecord {
  timestamp: number;
  functionName: string;
  cached: boolean;
  quotaCost: number;
}

interface FunctionStats {
  total: number;
  cached: number;
}

export interface APIStats {
  apiName: string;
  displayName: string;
  totalCalls: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  quotaLimit: number | null;
  quotaUsed: number;
  quotaUnit: string;
  quotaPeriod: string;
  lastRefresh: string | null;
  estimatedCost: string;
  callsByFunction: Record<string, FunctionStats>;
}

export interface UsageSnapshot {
  trackedSince: string;
  apis: APIStats[];
}

const API_CONFIGS: Record<ApiName, {
  displayName: string;
  quotaLimit: number | null;
  quotaUnit: string;
  quotaPeriod: 'month' | 'day';
}> = {
  mindbody: {
    displayName: 'MindBody',
    quotaLimit: 5000,
    quotaUnit: 'calls',
    quotaPeriod: 'month',
  },
  meta: {
    displayName: 'Meta (IG + FB)',
    quotaLimit: null,
    quotaUnit: 'calls',
    quotaPeriod: 'day',
  },
  youtube: {
    displayName: 'YouTube',
    quotaLimit: 10000,
    quotaUnit: 'units',
    quotaPeriod: 'day',
  },
  metaAds: {
    displayName: 'Meta Ads',
    quotaLimit: null,
    quotaUnit: 'calls',
    quotaPeriod: 'day',
  },
  googleAds: {
    displayName: 'Google Ads',
    quotaLimit: 15000, // Developer Token Basic Access limit
    quotaUnit: 'calls',
    quotaPeriod: 'day',
  },
  googleBusiness: {
    displayName: 'Google Business Profile',
    quotaLimit: null,
    quotaUnit: 'calls',
    quotaPeriod: 'day',
  },
  ghl: {
    displayName: 'GoHighLevel',
    quotaLimit: 200000,
    quotaUnit: 'calls',
    quotaPeriod: 'day',
  },
  yelp: {
    displayName: 'Yelp Fusion API',
    quotaLimit: 5000,
    quotaUnit: 'calls',
    quotaPeriod: 'day',
  },
  realself: {
    displayName: 'RealSelf Scraper',
    quotaLimit: null,
    quotaUnit: 'runs',
    quotaPeriod: 'day',
  },
  googleSearchConsole: {
    displayName: 'Google Search Console',
    quotaLimit: 2000,
    quotaUnit: 'queries',
    quotaPeriod: 'day',
  },
  kieAi: {
    displayName: 'Kie.ai (Creatives)',
    quotaLimit: null,
    quotaUnit: 'generations',
    quotaPeriod: 'day',
  }
};

// Module-level state (persists across requests in Node.js)
const apiCalls = new Map<ApiName, CallRecord[]>();
let trackedSince = new Date().toISOString();

/** Get current month key (YYYY-MM) */
function getMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Persist call count to Postgres (fire-and-forget) */
function persistToDb(api: string, cached: boolean) {
  const monthKey = getMonthKey();
  const callInc = cached ? 0 : 1;
  const cacheInc = cached ? 1 : 0;
  sql`
    INSERT INTO api_usage_monthly (api_name, month_key, total_calls, cache_hits)
    VALUES (${api}, ${monthKey}, ${callInc}, ${cacheInc})
    ON CONFLICT (api_name, month_key) DO UPDATE SET
      total_calls = api_usage_monthly.total_calls + ${callInc},
      cache_hits = api_usage_monthly.cache_hits + ${cacheInc}
  `.catch(() => { /* fire-and-forget — table may not exist yet */ });
}

/** Track an API call or cache hit */
export function trackCall(
  api: ApiName,
  functionName: string,
  cached: boolean,
  quotaCost: number = 1,
) {
  if (!apiCalls.has(api)) {
    apiCalls.set(api, []);
  }
  const records = apiCalls.get(api)!;

  records.push({
    timestamp: Date.now(),
    functionName,
    cached,
    quotaCost: cached ? 0 : quotaCost,
  });

  // Persist to Postgres for monthly totals
  persistToDb(api, cached);

  // Prune records older than 30 days
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  if (records.length > 500) {
    const firstValid = records.findIndex(r => r.timestamp >= cutoff);
    if (firstValid > 0) records.splice(0, firstValid);
  }
}

/** Fetch persistent monthly totals from Postgres */
async function getMonthlyTotalsFromDb(): Promise<Map<string, { totalCalls: number; cacheHits: number }>> {
  const monthKey = getMonthKey();
  const result = new Map<string, { totalCalls: number; cacheHits: number }>();
  try {
    const { rows } = await sql`
      SELECT api_name, total_calls, cache_hits
      FROM api_usage_monthly
      WHERE month_key = ${monthKey}
    `;
    for (const row of rows) {
      result.set(row.api_name, { totalCalls: row.total_calls, cacheHits: row.cache_hits });
    }
  } catch { /* table may not exist yet */ }
  return result;
}

/** Get aggregated usage stats for all APIs */
export async function getUsageStats(): Promise<UsageSnapshot> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  // Fetch persistent monthly totals
  const monthlyDb = await getMonthlyTotalsFromDb();

  const apis: APIStats[] = (Object.keys(API_CONFIGS) as ApiName[]).map(apiName => {
    const config = API_CONFIGS[apiName];
    const records = apiCalls.get(apiName) || [];

    // In-memory stats (current server instance)
    const memCalls = records.filter(r => !r.cached).length;
    const memCacheHits = records.filter(r => r.cached).length;

    // Persistent monthly totals from Postgres
    const dbStats = monthlyDb.get(apiName);
    const monthlyTotalCalls = dbStats?.totalCalls ?? memCalls;
    const monthlyCacheHits = dbStats?.cacheHits ?? memCacheHits;
    const monthlyTotal = monthlyTotalCalls + monthlyCacheHits;
    const cacheHitRate = monthlyTotal > 0
      ? Math.round((monthlyCacheHits / monthlyTotal) * 100)
      : 0;

    // Quota used — use DB monthly total for month-period, in-memory for day-period
    const quotaUsed = config.quotaPeriod === 'month'
      ? monthlyTotalCalls
      : records
          .filter(r => !r.cached && r.timestamp >= startOfDay.getTime())
          .reduce((sum, r) => sum + r.quotaCost, 0);

    // Last refresh = most recent non-cached call
    const lastActualCall = [...records]
      .filter(r => !r.cached)
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    const lastRefresh = lastActualCall
      ? new Date(lastActualCall.timestamp).toISOString()
      : null;

    // Per-function breakdown (in-memory only)
    const callsByFunction: Record<string, FunctionStats> = {};
    for (const r of records) {
      if (!callsByFunction[r.functionName]) {
        callsByFunction[r.functionName] = { total: 0, cached: 0 };
      }
      callsByFunction[r.functionName].total++;
      if (r.cached) callsByFunction[r.functionName].cached++;
    }

    return {
      apiName,
      displayName: config.displayName,
      totalCalls: monthlyTotalCalls,
      cacheHits: monthlyCacheHits,
      cacheMisses: monthlyTotalCalls,
      cacheHitRate,
      quotaLimit: config.quotaLimit,
      quotaUsed,
      quotaUnit: config.quotaUnit,
      quotaPeriod: config.quotaPeriod,
      lastRefresh,
      estimatedCost: '$0.00',
      callsByFunction,
    };
  });

  return { trackedSince, apis };
}

/** Reset all tracking data */
export function resetStats() {
  apiCalls.clear();
  trackedSince = new Date().toISOString();
}

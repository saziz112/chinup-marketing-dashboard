// API Usage Tracker — in-memory singleton for monitoring API call counts,
// cache efficiency, and quota consumption across all integrations.

type ApiName = 'mindbody' | 'meta' | 'metaAds' | 'youtube' | 'googleAds' | 'googleBusiness' | 'yelp' | 'realself' | 'googleSearchConsole';

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
  }
};

// Module-level state (persists across requests in Node.js)
const apiCalls = new Map<ApiName, CallRecord[]>();
let trackedSince = new Date().toISOString();

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

  // Prune records older than 30 days
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  if (records.length > 500) {
    const firstValid = records.findIndex(r => r.timestamp >= cutoff);
    if (firstValid > 0) records.splice(0, firstValid);
  }
}

/** Get aggregated usage stats for all APIs */
export function getUsageStats(): UsageSnapshot {
  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const apis: APIStats[] = (Object.keys(API_CONFIGS) as ApiName[]).map(apiName => {
    const config = API_CONFIGS[apiName];
    const records = apiCalls.get(apiName) || [];

    // All-time stats for display
    const totalCalls = records.filter(r => !r.cached).length;
    const cacheHits = records.filter(r => r.cached).length;
    const cacheMisses = totalCalls;
    const totalRecords = records.length;
    const cacheHitRate = totalRecords > 0
      ? Math.round((cacheHits / totalRecords) * 100)
      : 0;

    // Quota used — filter by period (only non-cached calls count)
    const periodStart = config.quotaPeriod === 'day'
      ? startOfDay.getTime()
      : startOfMonth.getTime();

    const quotaUsed = records
      .filter(r => !r.cached && r.timestamp >= periodStart)
      .reduce((sum, r) => sum + r.quotaCost, 0);

    // Last refresh = most recent non-cached call
    const lastActualCall = [...records]
      .filter(r => !r.cached)
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    const lastRefresh = lastActualCall
      ? new Date(lastActualCall.timestamp).toISOString()
      : null;

    // Per-function breakdown
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
      totalCalls,
      cacheHits,
      cacheMisses,
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

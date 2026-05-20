# Test Coverage Analysis

## Current State

**Before this analysis: zero test coverage.** No testing framework, no test files, no coverage configuration existed in the codebase.

This analysis sets up **Vitest** as the testing framework and provides initial tests for the most critical pure business logic, along with a prioritized roadmap for expanding coverage.

---

## Codebase Overview

| Category | Files | Lines (approx) |
|---|---|---|
| API Routes | 57 | ~12,000 |
| Library / Business Logic | 13 | ~6,400 |
| Integrations | 20 | ~9,400 |
| Pages / UI | 11 | ~4,000 |
| Components | 2 | ~320 |
| **Total** | **109** | **~32,000** |

---

## Initial Tests Added

| Module | Tests | What's Covered |
|---|---|---|
| `attribution.ts` | 12 | Source mapping for all platforms, edge cases (null, dates, case sensitivity) |
| `dnd-check.ts` | 11 | DND flag checks, channel-specific blocking, tag matching, phone normalization, hashing |
| `cache.ts` | 4 | Cache miss, set/get round-trip, TTL expiration, key sanitization |

---

## Priority Areas for Test Improvement

### P0 — Critical Business Logic (add tests immediately)

1. **`ghl-strategy.ts`** (824 lines) — The strategic intelligence engine that drives CEO-level pipeline insights. Contains complex lead scoring, funnel analysis, and recovery projections. A bug here produces incorrect business decisions. Test the `getStageRecommendation`, severity classification, and funnel drop-off calculations by extracting pure functions and mocking the GHL data layer.

2. **`content-publisher.ts`** (401 lines) — Manages post scheduling and publishing. The status state machine (`DRAFT → SCHEDULED → PUBLISHING → PUBLISHED/PARTIAL/FAILED`) and the `rowToPost` DB serialization are high-value test targets. Mock `@vercel/postgres` and test the state transitions and error handling.

3. **`api-usage-tracker.ts`** (249 lines) — Tracks API quotas across 12 integrations. The `trackCall` in-memory record management, pruning logic, and `getUsageStats` aggregation can be tested in isolation by mocking the Postgres `sql` calls.

4. **API Route Authentication** — All 57 API routes should verify they reject unauthenticated requests and enforce role-based access. A lightweight integration test that mocks `getServerSession` and asserts 401/403 responses would cover this systematically.

### P1 — Integration Layer (add mocked tests)

5. **`integrations/ghl-conversations.ts`** (1,962 lines) — The largest file in the codebase. Handles SMS/call/email conversation parsing and intelligence. Extract and test the conversation classification logic, DND detection, and message threading by mocking HTTP responses.

6. **`integrations/meta-organic.ts`** / **`meta-ads.ts`** / **`meta-publisher.ts`** — Test the data transformation and normalization functions that parse Meta API responses. Mock `fetch` calls and verify the output shapes match what the dashboard pages expect.

7. **`integrations/google-ads.ts`** / **`google-business.ts`** — Test the query building and response parsing. The Google Ads API has complex query formats that are prone to subtle bugs.

8. **`integrations/mindbody.ts`** / **`mindbody-sync.ts`** — Test the appointment and sales data sync logic. MindBody data has known quirks (inconsistent date formats, nullable fields) that should be covered with edge-case tests.

### P2 — Data Layer & Caching

9. **`pg-cache.ts`** — The Postgres-backed cache. Test TTL enforcement, key collision handling, and the fallback behavior when the database is unavailable.

10. **`db.ts`** (4,254 lines) — While testing the full schema init is impractical, the helper functions and query builders embedded in this file should be extracted and unit tested. Consider splitting this monolith into smaller modules.

### P3 — UI & Pages

11. **`components/DateRangePicker.tsx`** — The most reusable UI component. Test rendering, date selection, and range validation using `@testing-library/react` (already installed).

12. **Dashboard pages** — Add lightweight smoke tests for each page that verify they render without throwing. Mock all API calls and test the data transformation logic in the pages.

### P4 — End-to-End & Cron Jobs

13. **Cron routes** (`publish-scheduled`, `analyze-conversations`, `sync-research`) — These run daily unattended. A failure can go unnoticed for days. Test the happy path and error handling with mocked external APIs.

14. **Auth flow** — Test the login page, session handling, password change, and role-based redirects end-to-end using a tool like Playwright or Cypress.

---

## Recommended Testing Architecture

```
src/
  lib/
    __tests__/           ← Unit tests for business logic (P0)
      attribution.test.ts    ✅ Done
      dnd-check.test.ts      ✅ Done
      cache.test.ts          ✅ Done
      ghl-strategy.test.ts
      content-publisher.test.ts
      api-usage-tracker.test.ts
    integrations/
      __tests__/         ← Mocked integration tests (P1)
        ghl-conversations.test.ts
        meta-organic.test.ts
        meta-publisher.test.ts
  app/
    api/
      __tests__/         ← API route tests (P0/P1)
        auth.test.ts
        health.test.ts
    (dashboard)/
      __tests__/         ← Page smoke tests (P3)
  components/
    __tests__/           ← Component tests (P3)
      DateRangePicker.test.tsx
e2e/                     ← End-to-end tests (P4)
```

## Quick Wins

These are high-impact, low-effort tests to add next:

1. **Health endpoint** — Trivially testable, ensures the deploy check works.
2. **`config.ts` exports** — Validate the nav items, user configs, and platform accounts are well-formed (no broken hrefs, no duplicate IDs).
3. **`posting-goals.ts` week calculation** — The Monday-calculation logic has a subtle `setDate` mutation bug (modifies `today` in place). A test would catch this.
4. **Snapshot tests for API response shapes** — Ensure API routes return consistent JSON structures that the frontend expects.

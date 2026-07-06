# Marketing Dashboard — Zenoti Migration Plan

**Status:** Planning complete, awaiting go-ahead to implement.
**Author:** Claude + Sam · **Date:** 2026-07-06
**Companion:** Monthly Bonus Dashboard already migrated (`~/dev/chinup/monthly-bonus-dashboard`, `Zenoti Migration/*`). This doc is the marketing-side counterpart.

---

## 1. Why this migration exists (the accuracy bug)

Chin Up went live on Zenoti ~**2026-06-29** and is **Zenoti-only from July 1** (June 29–30 were deliberately dual-entered in both MindBody and Zenoti for a parallel-run check). This dashboard still syncs from the **MindBody** API, whose data has now dried up (max sale_date `2026-07-02`, and those 4 rows are $0 stragglers).

Consequence: **every patient treated in Zenoti since 7/1 is invisible here.** They silently fall into the **lapsed-patient** and **maintenance-reminder** segments and would receive "we miss you" / "you're due" texts while actually being active. Fixing this — getting Zenoti visit activity flowing into the segmentation engine — is the whole point.

## 2. How this differs from the Monthly Dashboard migration

| Dimension | Monthly Bonus Dashboard | Marketing Dashboard (this app) |
|---|---|---|
| Data pattern | Live-fetch sales + cache; raw `zenoti_sales` store | **Backfill-and-store**: API → Postgres → queried |
| What migrates | Swap `getSales`→`getZenotiSales` in 5 read routes | Swap the **write/sync path** that fills the tables |
| Hard problem | Revenue reconciliation (gross/net, redemptions) | **Cross-system patient identity** + preserve 5 yrs history |
| Time horizon | Current month (pre-6/29 ignorable) | **Full history required** (lapsed = 60–425 days no visit) |

**Reusable asset (port, don't import — separate DB & repo):** the monthly repo's `src/lib/zenoti.ts` (`getZenotiAppointments`, `getZenotiInvoice`, `searchZenotiGuests`, `getZenotiGuest`, `getZenotiServices`, `zenotiCall`, status enum, `chunkDateRange`) and `zenotiSales.ts` (`ZenotiSalesRow`, `fetchZenotiSalesRows`, `zenotiRowsToSales`). `ZenotiSalesRow` already carries clean `item_type` / `item_category` / `guest_id` / `guest_name` / `sale_date` / `collected` / `item_name`.

## 3. Decisions locked (Sam, 2026-07-06)

1. **MindBody = frozen at cutover.** Authoritative **through 6/30**. Zenoti owns **7/1 →**. Not run in parallel going forward.
2. **Unified tables + `source` column.** Append Zenoti rows into the existing `mb_sales_history` / `mb_clients_cache` / `mb_appointments_history` with `source='zenoti'`. Every existing read query runs unchanged.
3. **Priority = lapsed + maintenance segments first**, then expand to attribution/revenue/leads/ROAS.

## 4. The clean seam (no double-count)

- MindBody rows: keep all **≤ 6/30**. **Purge the 4 `$0` straggler rows dated ≥ 7/1** (dual-entry noise).
- Zenoti backfill window: **start 7/1** (NOT 6/29 — June 29–30 already live in MindBody from the dual run; importing Zenoti's copy would double-count).
- Result: MindBody 2020-12-21 → 2026-06-30, Zenoti 2026-07-01 → present, zero overlap.

## 5. ID collision & column types — CORRECTED 2026-07-06

Values don't collide (MindBody numeric vs Zenoti GUID). **BUT the plan's original claim that they "coexist safely in the same columns" was wrong:** `mb_sales_history.sale_id` and `mb_appointments_history.appointment_id` ship as **`INTEGER PRIMARY KEY`** — a GUID cannot be inserted. `client_id` is already `TEXT` (fine). So the unified-tables decision requires a **one-time schema migration widening those two PKs to `TEXT`** (`ALTER COLUMN … TYPE TEXT USING …::text`, non-destructive; existing numeric IDs become their text form; downstream never does integer math on them). Handled by `migrateSchemaForZenoti()` in `zenoti-sync.ts` — idempotent (checks `information_schema`, no-ops once done). `source TEXT NOT NULL DEFAULT 'mindbody'` is added by the same function (tags all existing rows). **This ALTER is a production schema change — run it deliberately with Sam's go, not on a sync hot path.**

## 6. What MUST be preserved (do not touch)

- `src/lib/treatments.ts` — `normalizeTreatment()`, `TREATMENT_CADENCE`, `TREATMENT_DISPLAY`, `MAINTENANCE_LOOKBACK_DAYS`. The maintenance engine.
- `getLapsedPatientsFromDB` identity-merge SQL (phone/email de-dupe across duplicate people) — this is what makes cross-system identity work; feed Zenoti through it, don't rewrite it.
- The `items_json` `{ Description, IsService, TotalAmount }` shape. **The Zenoti writer must emit this shape** (map `item_name`→`Description`) so `normalizeTreatment` + all downstream stays unchanged.
- Campaign-segment logic, 12% holdout, GHL messaging, DND checks.

## 7. Field mappings

### 7a. Sales (`ZenotiSalesRow` → `mb_sales_history`)
| mb column | from Zenoti | notes |
|---|---|---|
| `sale_id` | `invoice_item_id` (or `invoice_id`+line idx) | GUID; unique per line |
| `client_id` | `guest_id` | GUID; the identity key |
| `sale_date` | `sale_date` (date part) | 7/1+ only |
| `location_id` | center_id → 1/2/3 map | mirror monthly `LOCATION_IDS` |
| `total_amount` | `collected` | cash basis; **filter `status='Closed'`, drop refunds' Open dup** |
| `payments_total` | `collected` | keep consistent with revenue reads |
| `items_json` | `[{ Description: item_name, IsService: item_type==='Service', TotalAmount: collected }]` | drives `normalizeTreatment` |

⚠️ **Reconcile in P3:** Zenoti models injectables as `$0 base Service + per-unit Product` at checkout. `normalizeTreatment` matches `/botox/` regardless of `IsService`, so it should still classify a "Botox 20u" **Product** line — but this must be verified against real `item_name`s, and the regex extended where Zenoti naming diverges (use `item_category` = `Injectables` / `Retail Skincare` as a backstop signal).

### 7b. Appointments (`getZenotiAppointments` → `mb_appointments_history`)
Zenoti status enum → existing string statuses the lapsed query keys on:
| Zenoti | enum | → mb status |
|---|---|---|
| Closed | 1 | `Completed` (service delivered) |
| New | 0 | `Booked` |
| Confirmed | 4 | `Confirmed` |
| Cancelled | -1 | `Cancelled` **(WIN — MindBody dropped cancels)** |
| NoShow | -2 | `NoShow` |
| Blockout | 10 | **filter out** (no service) |

Lapsed activity keys on `Completed`/`Arrived`; future-booked exclusion keys on `Booked`/`Confirmed` with `start_date > NOW()`. Mapping above preserves both.

### 7c. Guests (`getZenotiGuest` → `mb_clients_cache`)
Sales rows give `guest_id` + `guest_name` but **not phone/email** — which the identity merge needs. Backfill per-guest via `getZenotiGuest(guest_id)` (like the MindBody `getClients` pattern), phone-normalized into `phone`. Respect the **60 calls/min org-wide** limit — chunk + throttle.

## 8. Phased execution

- **P0 — Port Zenoti client. ✅ DONE 2026-07-06 (local).** Created `src/lib/integrations/zenoti.ts` — read-only port (dropped the monthly app's `config`/bonus coupling and the write ops `confirm`/`cancel`). Added `'zenoti'` to `api-usage-tracker.ts` (`ApiName` + `API_CONFIGS`). Copied 4 `ZENOTI_*` vars into local `.env.local`. Smoke (`scripts/zenoti-smoke.mjs`) green: 3 centers resolve, 12 real Decatur sales rows for 7/1, appointments pull works. `tsc --noEmit` clean.
  - **⚠️ Gotcha found & fixed:** `/v1/appointments` `end_date` is **EXCLUSIVE** (`7/1..7/2`→only 7/1; `7/1..7/1`→0). The sales flat_file endpoint is the opposite (inclusive, datetime). The port's `getZenotiAppointments` now queries `end_date = chunkEnd + 1 day` so its `[start,end]` contract is inclusive. *(The monthly repo's version has the latent off-by-one — flag separately.)*
  - **Real 7/1 `item_name`s (feed P3 regex check):** `Dysport - Per Unit`, `Restylane Lyft`, `Restylane Contour`, `Cheek / Midface Filler`, `SkinPen Microneedling`, `Injection Fee`, `Existing Dysport Patient`, `NP Consultation - Injectables / Skincare`, `Custom Package-…`, `VIP Membership`. Confirms §7a: injectables land as per-unit **Product** lines (`Dysport - Per Unit`).
  - **Still pending (not blocking P1 local dev):** add the `ZENOTI_*` vars to **Vercel** (production action — needs Sam's go); `ZENOTI_UPDATED_BY_ID` intentionally omitted (write-only field, unused by the read path).
- **P1 — Zenoti sync writers. ✅ CODE DONE 2026-07-06 (no DB writes yet).** `src/lib/integrations/zenoti-sync.ts`: `migrateSchemaForZenoti` (§5 widen + source col), `backfillZenotiSales`, `backfillZenotiAppointments`, `backfillZenotiGuests` (resumable, 40/call, 1.1s throttle < 60/min), `incrementalZenotiSync` (2-day overlap, floored at cutover). Distinct `zenoti_*` sync_type keys. Idempotent UPSERTs keyed on invoice_item_id / appointment_id GUIDs. `sql.json()` for items_json. `tsc` clean.
  - **Design divergence from monthly (deliberate):** marketing KEEPS `$0`-collected Closed lines — they're package/membership redemptions that still name a real treatment the patient received (dry-run: 79 of 151 lines). Monthly drops them (bonus logic). Verified: those $0 lines carry names like "VI Chemical Peel", "Cool Peel Laser (CO2)".
  - **Free guest harvest:** appointment payloads embed full `guest` (email + `mobile.display_number`), so `mb_clients_cache` fills from appts at zero API cost; only sales-only guests (dry-run: 15 of 77) need a `getZenotiGuest` fallback.
  - **P3 gate previewed via `scripts/zenoti-dryrun.mjs` (read-only) — coverage is strong:** 34/68 distinct 7/1–7/6 item_names classify; every fall-through is a correct exclusion (consults, no-show fees, retail skincare, package containers, memberships, pre-paid/gift cards, B12/Tirzepatide weight-loss). **Only genuine open item: `PRP Topical Add-On`** [Service/Aesthetic Services] is currently unclassified — clinical call whether PRP counts as a tracked maintenance treatment. Injectables/fillers/tox/peels/CoolPeel/HydraFacial/Emsculpt/Microneedling/LHR/Lip Flip/Dermaplaning/Sculptra all classify correctly out of the box.
  - **Dry-run totals (7/1→7/6, all 3 centers):** 151 Closed sales lines · $45,024.14 net · 77 sales guests · 128 appts (117 Completed / 7 Confirmed / 4 Booked).
- **P2 — Freeze MindBody + wire cron.** Purge 4 straggler rows > 6/30. Stop advancing MindBody incremental sync (freeze). Add `incrementalZenotiSync` to `cron/sync-research` alongside the existing invalidation of `lapsed_v2_/cancelled_/consult_` caches.
- **P3 — Backfill + reconcile.** Run Zenoti backfill 7/1→now. **Verification gate:** (a) pick a patient known to have visited via Zenoti in July → confirm they NO LONGER appear in `getLapsedPatientsFromDB`; (b) run real Zenoti `item_name`s through `normalizeTreatment`, list what falls through, extend regex; (c) spot-check treatment counts vs Zenoti UI.
- **P4 — Identity crosswalk hardening.** Confirm a MB-March + Zenoti-July same-person merges (phone/email). Verify `getAvailableTreatments` + maintenance "due" detection see the newest Zenoti visit. Only after this is green: expand to attribution/leads/revenue/ROAS read routes (they already read the unified tables, so mostly free — but reconcile).

## 9. Verification-before-ship checklist

- [ ] A July-Zenoti-active patient is absent from lapsed segments.
- [ ] Maintenance "due" windows fire off the newest (Zenoti) treatment date.
- [ ] No double-counted June 29–30 revenue (MindBody owns them).
- [ ] Cross-system identity: same phone/email in MB + Zenoti = one person.
- [ ] `normalizeTreatment` coverage report on real Zenoti item names (no silent drops of real treatments).
- [ ] Cron runs both a frozen-MB no-op and a live Zenoti incremental without error.
- [ ] 12% holdout + DND still intact.

## 10. Open items to confirm during build

- Exact Zenoti `item_name` vocabulary (drives §7a regex extension).
- Whether `getZenotiGuest` returns both mobile + email reliably for merge.
- Marketing dashboard's own `ZENOTI_*` creds (monthly's key may or may not be scoped for this app's calls; likely reuse same org key).

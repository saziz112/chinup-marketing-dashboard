# Marketing Dashboard — Post-Zenoti Migration Plan
Date: 2026-07-15 · Source interview: SamOS/brainstorms/2026-07-15-marketing-dashboard-zenoti-migration-plan.md
Rule: a data section is ✅ only after its numbers match Zenoti's own reports (July window) within rounding.

## Phase 1 — Correctness fixes (KPIs are wrong today)
1. ✅ **Fix New Leads double-count** — cross-source identity merge (phone/email peers) in `getNewClientsCountFromDB` so returning MB patients reappearing in Zenoti aren't counted as new. (`mindbody-db.ts:70-87`)
2. ✅ **Fix leads period toggle** — `/api/metrics/leads` honors 7d/30d/90d instead of hardcoded 30d; Overview insight text matches. (`leads/route.ts`, `page.tsx`)
3. ✅ **Fix ROAS revenue undercount** — identity-merge `getClientEmailMapFromDB` (aggregate revenue across phone/email peer group per email). Affects Meta + Google ROAS. (`mindbody-db.ts:93-132`)
4. ✅ **Fix active-patient suppression** — conversation-intelligence `isActive` must see Zenoti sale-only activity (union `mb_sales_history`), not just completed appointments. (`ghl-conversations.ts:687-943`)
5. ✅ **Fix never-booked fallback** — drop the dead MindBody-API fallback; use `mb_clients_cache`. (`ghl-reactivation/route.ts:685-694`)
6. ✅ **Dedicated Zenoti sync cron** — move `incrementalZenotiSync` out of `sync-research` into its own cron in `vercel.json`.
7. ✅ **Remove MindBody sync paths** — delete "Sync All (MB + GHL)" / "Sync MindBody Only" buttons + cap/retire `incrementalSync` at 2026-06-30. (`settings/page.tsx:776-778`, `admin/data-sync/route.ts`, `mindbody-sync.ts:335-381`)

## Phase 2 — Cuts
8. ✅ **Remove Content + Publish** — pages, `/api/content/*`, and the 7am `publish-scheduled` cron (posting happens elsewhere).
9. ✅ **Remove Creatives** — page + `/api/creatives/*` (creatives generated in other tools).
10. ✅ **Campaign performance readout** — pull sent/reply/booked numbers per segment; confirm ghost-reactivation is dead, decide fate of any other non-performers.
11. ✅ **Cut dead campaigns** — remove ghost (+ any others from #10) from Attribution UI and reactivation API.

### Readout results (2026-07-15, items 10+18)
- Runs to date: maintenance 45 runs/773 sent (live, ran today), lapsed-vip 23/817 (live), consult-only 15/359 (live), lapsed-winback 12/1244 (dormant since 5/5), lapsed-long 3/385 (one day, 4/27). ghost + never-booked: ZERO runs ever.
- 30-day booking rate: maintenance treated 16.0% vs holdout 14.8% (+1.2pp, NOT yet statistically significant, ~0.75σ; caveat: holdout rows logged per-run, some patients repeat). consult-only 3.1%, lapsed-vip 1.8%, lapsed-long 1.6%, lapsed-winback 0.6%.
- Maintenance failure count high: 391 failed contact rows vs 773 sent — investigate (missing GHL contact/phone?).

## Phase 3 — Label & copy sweep
12. ✅ **Relabel MindBody → unified** — Overview "From Zenoti", Ads "POS Revenue"/"POS-verified", Attribution "patient records" badges + stageName, Knowledge rewrite (platforms grid, segments list reflects 7/15 cuts, data-sources table, limitations), Settings Zenoti connection + POS sync counts, Research empty-state.
13. ✅ **Fix client deep-links** — MB deep-link now only built for legacy numeric client IDs (roas route + google-ads.ts); Zenoti GUIDs show a "Zenoti" badge (no admin URL available — revisit if Sam wants Zenoti guest deep-links). `SaleRow.sale_id` type corrected to string.

## Phase 4 — Verification vs Zenoti (section by section)
14. ✅ **Overview** — verified 7/1–7/14 vs Zenoti API + Business KPI report (2026-07-15):
    - Revenue: ✅ HEALED 2026-07-15 post-deploy sync — DB $132,911.02 = Zenoti accrual report exactly (was Δ $867.98: 4 late-closing membership lines + 1 edited invoice, missed by the old 2-day sync overlap → **widened to 14 days**, `zenoti-sync.ts`).
    - Appointments: ✅ HEALED — 81 cancellations now captured (Zenoti API omits them without **`include_no_show_cancel=true`**, added to `getZenotiAppointments`); Completed matched Zenoti exactly pre-fix (373=373). Remaining past-dated Booked/Confirmed rows are invoices staff haven't closed in Zenoti yet. Also unblocks item 20 no-show recovery + fixes future-booked suppression for cancellers.
    - New Leads: ✅ RECONCILED vs Zenoti Business KPI export (Sam pulled 2026-07-15). Zenoti "New Guest Count" = 173 (32 Vinings + 85 Kennesaw + 56 Decatur) but that's new-to-ZENOTI (its history starts 7/1, so returning MindBody patients look new — hence its 82–91% "new" rate). DB bridge: 160 new-to-Zenoti guests with non-$0 purchase (≈173, Δ is open-invoice/redemption counting), of which **45 are truly new to the business** after the phone/email identity merge vs MindBody history. 45 is the authoritative number (use for Emily's lead reporting, not Zenoti's).
15. ✅ **Ads** — verified 2026-07-15:
    - ROAS revenue layer ✅: email→revenue map covers 167 emails for 7/1–7/14; window revenue = $132,911.02 matches Zenoti exactly; zero MindBody rows post-7/1 (seam clean). Known minor: single-hop peer groups over-map ~$6.5K ceiling (only double-counts if 2+ emails of one household both submitted lead forms).
    - Offline-conversions pipeline — PARKED (Sam's call 2026-07-15): removed the daily `/api/cron/google-offline-conversions` cron from `vercel.json`; both the cron route and `/api/track/gclid` now short-circuit to `200 {parked:true}` when `GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID` is unset (was 500). Auto-revives if that env var is set + db init run + cron re-added. No more daily 500s.
    - Stray caller to deleted `/api/content/publish-due`: route is deleted so hits now 404 (harmless, was never a 500). Source is an external n8n workflow — n8n API unreachable from here (`n8n.chinupaesthetics.com` NO_RESPONSE); disabling the workflow needs Sam's n8n console. OPEN (cosmetic log noise only).
16. ✅ **Attribution** — suppression spot-check via the real fetchers against the live DB (2026-07-15):
    - maintenance: CLEAN (eligible 515; 0 future-booked leaks, 0 seen-after-anchor leaks).
    - lapsed-vip (≥120d) + lapsed-long (≥180d): recency suppression CLEAN, but found **34 future-booked leaks** (23 vip + 11 long) — patients already rebooked under a **Zenoti GUID** (e.g. Hannah Hacker booked 7/17) that `getLapsedPatientsFromDB`'s `client_id`-only `NOT IN future_booked` missed. **Fixed:** peer-expanded the future-booked suppression to a `future_contacts` phone/email `NOT EXISTS` (mirrors the existing `active_contacts` recency merge). Post-fix re-run: vip 5,529→5,506, long 5,146→5,135, **0 leaks all segments**.
    - Residual: **consult-only** couldn't be run locally (fed by the live MindBody API, frozen ≤6/30). Its cross-source *conversion* suppression is in place (f4b0d7d), but a pre-cutover consult patient who rebooked a *future* Zenoti appt isn't caught by the MindBody-only `rebookedIds` — low risk (shrinking cohort), verify when convenient.
    - Conversation-lifecycle segments (untouched / attempted-no-reply / quoted-followup) key on GHL stage, not history suppression — out of scope for these three checks.
17. ✅ **Organic + Reputation + Research** — verified via 7-day prod runtime-error sweep + static read (2026-07-15):
    - **Organic** (IG/FB/YT/TikTok) — CLEAN: zero runtime errors in 7d; active code already uses valid post-Nov-2025 Meta metrics (no deprecated `page_impressions`/`page_fans`/etc). Stale `claude-sonnet-4-5-20250514` 404s in the error log trace to the *deleted* `/api/creatives/*` routes (Phase 2 cut) — harmless 404s from an external caller, not live code.
    - **Reputation** (reviews/competitors/search) — CLEAN: zero runtime errors in 7d.
    - **Research** — found + **fixed** the one hard error: `/api/research/calendar` GET threw 500 `relation "research_calendars" does not exist` (42P01) on every saved-calendar load (last seen 16:00 today); POST's insert silently failed under `.catch`. The table's `CREATE TABLE IF NOT EXISTS` lived only in the never-run global db init. Added a self-migration `ensureCalendarTable()` before read + write (commit 7de4a96). Table confirmed present in prod DB (empty) so GET now returns `{saved:false}` cleanly. All research routes use the valid `claude-haiku-4-5-20251001` model. `ghl_recent`/`client_match` "missing tables" were false alarms (CTE names).
    - **Residual (degradation, not an error) — DECISION PENDING:** the "treatment booking trends" data source in both `calendar` and `trends` queries `mb_appointments_history.session_type_name`, which is NULL for 100% of rows post-migration → that signal is silently empty (fails soft inside `Promise.allSettled`). Fix = pull `mb_sales_history.items_json` + `normalizeTreatment()` in JS in both routes (a behavior change to what the AI calendar/Trend-Scout sees — surface before shipping per the campaign-criteria rule). The other data sources (Search Console, reviews, content-gaps, format-perf, lead-source conversion) are intact.
18. ✅ **Maintenance Due holdout readout** — read 12% holdout vs treated lift (instrumented since May) before investing in #19.

## Phase 5 — Enhancements (approved)
19. ⬜ **Maintenance split by last treatment** — segment cadence + messaging by last treatment received (Botox/filler/Sculptra/laser/etc.); verify `normalizeTreatment()` handles Zenoti item names.
20. ⬜ **No-show recovery campaign** — NEW (Zenoti tracks NoShow/cancellations; Mindbody couldn't): same-week rebook text via GHL.
21. ⬜ **Campaign scoreboard** — per-campaign funnel: sent → replied → booked → showed → revenue, with holdout lift where instrumented.
22. ⬜ **Lead-source conversion tracking (Emily/Well Labs)** — lead = prospect with no purchase; sources: Website, Paid Search, Email, Call-in, Walk-in, Referral; metrics: Booking Rate, Consult Show Rate, Lead→Sale Conversion. Flag: capture mechanics for Call-in/Walk-in need a source stamp at creation.
23. ⬜ **Gift-card balance activation campaign** — target unredeemed balances (~$12.8K).
24. ⬜ **Wellness/GLP-1 cross-sell campaign** — aesthetics↔wellness cross-promotion; ties into wellness-waitlist LP.
25. ⬜ **Event blast segment builder** — pick segment (lapsed, treatment, location) → push event invite via GHL.
26. ⬜ **Enhance Research page** — scope with Sam (sources, cadence, local-competitor focus).
27. ⬜ **New-campaign brainstorm session** — with #21's scoreboard data in hand.

## Backlog (not scheduled)
- Show-rate analytics (no-show rate by location/provider/booking source)
- Membership save + package-completion campaigns
- Birthday month offer
- Cohort LTV by acquisition channel

## Status key
⬜ Not Started · 🔄 In Progress · ✅ Completed (data sections require Zenoti cross-check)

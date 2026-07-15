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
12. ⬜ **Relabel MindBody → unified** — Overview "From MindBody", Ads "MB Revenue"/"MindBody verified", Attribution `source:'mindbody'` badges + stageName strings, Knowledge page copy rewrite.
13. ⬜ **Fix client deep-links** — replace `mindbodyonline.com?clientID=` links (broken for Zenoti GUIDs) with Zenoti guest links or remove.

## Phase 4 — Verification vs Zenoti (section by section)
14. ⬜ **Overview** — new-client count + revenue vs Zenoti reports, July window.
15. ⬜ **Ads** — ROAS match-rate + matched revenue vs Zenoti sales; offline-conversions cron uploading Zenoti-era conversions.
16. ⬜ **Attribution** — each surviving segment returns correct patients (spot-check suppression: future-booked, recently active, rebooked).
17. ⬜ **Organic + Reputation + Research** — pipelines fetch fresh data without error; fix whatever surfaces.
18. ✅ **Maintenance Due holdout readout** — read 12% holdout vs treated lift (instrumented since May) before investing in #19.

## Phase 5 — Enhancements (approved)
19. ✅ **Maintenance split by last treatment** — segment cadence + messaging by last treatment received (Botox/filler/Sculptra/laser/etc.); verify `normalizeTreatment()` handles Zenoti item names.
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

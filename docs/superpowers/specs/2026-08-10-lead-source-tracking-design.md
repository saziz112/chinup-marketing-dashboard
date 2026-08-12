# Lead Source Tracking (PLAN item 22) — Design

**Date:** 2026-08-10
**Status:** Validated against live data, not yet implemented

## Problem

Nobody can answer "where do our leads come from, and which sources are worth
money?" Emily's taxonomy (Website, Paid Search, Email, Call-in, Walk-in, Referral)
plus paid social and Instagram DM describes the channels, but nothing measures them
end to end. The Leads Pipeline looks like it should answer this and cannot: 1,038 of
1,984 Kennesaw opportunities sit in "Called 2x" with a median 97 days untouched, so
stage position records staff behaviour, not patient outcome.

## What was fixed first (prerequisites, done 2026-08-09)

Capture had to be trustworthy before measurement meant anything.

- **Native Meta attribution confirmed.** GHL stores `attributionSource` and
  `lastAttributionSource` per contact — session source, form name, campaign, ad set
  and ad IDs, first and last touch. The contact *list* endpoint omits these; the
  single-contact GET returns them. Coverage is 100% of paid-social leads in all
  three locations. An earlier plan to hand-map UTM fields on every Facebook form was
  withdrawn: those hidden fields are static text typed into the form builder and are
  wrong (`botox-kennesaw` appearing on Decatur contacts), and `{{ad.name}}` arrives
  as a literal macro Meta never substitutes.
- **Call-in stamping built.** `Attribution - Stamp Call-in Source`, published in all
  three locations: two Contact-tag triggers (`name via lookup`,
  `couldn't find caller name`) → condition `Source is empty` → set
  `Contact source = Call-In`. Verified live: a new caller was stamped correctly and
  14 non-call contacts were left untouched. **It captures first-time callers, not all
  calls** — a known contact who phones in is not tagged, so the metric must be
  labelled "new call-in leads", never "calls".
- **Phone merge tag repaired** in the Botox workflows (Decatur, Smyrna).
- **Open defect, cause unknown, not blocking:** the `All Locations - Filler $100 OFF
  Form` (created 13 Jul) has delivered leads only since **5 Aug** — seven in total,
  all present in Kennesaw and Smyrna, **none in Decatur**. Kennesaw and Smyrna each
  correctly claim their own two and ignore the rest; Decatur's three (Tonya Martin,
  Regina Mccoy, Grady Bland) exist in neither of Decatur's own records and sit
  untagged and unassigned in the other two sub-accounts.

  Ruled out in Decatur (verified live 11 Aug): field mapping is complete and enabled
  for this form; the Facebook Page connection works (40 Botox + 13 Microneedling
  leads since 13 Jul); the `Preferred Location` field is identical across all three
  sub-accounts (`Decatur` / `Kennesaw` / `Smyrna/Vinings`); the workflow is published
  with the right form and filter. **An earlier version of this spec claimed the form
  was never mapped in Decatur and that four weeks were lost — both were wrong.**

  Leading untested hypothesis: the mapping was confirmed but never committed with the
  outer dialog's Save. Test is the next Decatur-preferring lead (~1/day). If it still
  fails, look at Page-level lead access per sub-account.

  **Detection gap worth generalising:** nothing in GHL reports that a form is live in
  two sub-accounts and silent in a third. Only a per-form, per-location arrival count
  surfaces it — a view the product does not offer and this dashboard should.

## Scope

One lead-source view: rows are sources, columns are the funnel, filterable by
location and date window.

| Stage | Definition | System of record |
|---|---|---|
| leads | GHL contacts created in window, deduped per person | GHL |
| new leads | leads with no purchase before the lead date | Zenoti / MindBody |
| showed | appointment `Completed` / `Arrived` within window | Zenoti / MindBody |
| revenue | sales within window | Zenoti / MindBody |
| spend, CPL, cost/showed | live Meta and Google APIs | ad platforms |

## Non-negotiable rules

Each of these changed the answer during validation. They are requirements, not
style preferences.

1. **Deduplicate per person, never sum sub-accounts.** "All Locations" forms create
   a contact in *every* location. Ten `$100 OFF` submissions exist as ~20 contact
   records. Summing sub-accounts reports roughly 3× the real lead count.
2. **One client match per contact.** A contact whose phone matches one client row and
   whose email matches another fans out in the join. Uncorrected this reported
   **$284k** of revenue against a true **$172k**. Enforce with
   `DISTINCT ON (contact_id)`.
3. **Separate existing patients from new leads.** A lead is someone with no prior
   purchase (Emily's definition). Before splitting, `(blank)` looked like a top
   performer; 132 of its 758 were existing patients whose ordinary spending was
   being credited to a lead source.
4. **Equal maturation.** Compare only leads old enough to have converted, and give
   each the same window (default: leads aged 30–90 days, 30 days to convert).
   Otherwise recent-heavy sources look artificially bad.
5. **Never read source or outcome from the Leads Pipeline.** `Opportunity Source` is
   populated from `{{contact.utm_source}}` — the known-wrong static field — and
   `Opportunity Value` is hardcoded to $649 per filler lead, so pipeline value is a
   constant times lead count.

## Validated baseline (2026-08-10)

Leads aged 30–90 days, each given exactly 30 days to convert:

| Source | New leads | Showed | Show rate | Revenue | Rev/lead |
|---|---|---|---|---|---|
| Paid social | 483 | 36 | 7% | $23,853 | $49 |
| (blank) | 376 | 52 | 14% | $39,711 | $106 |
| Website | 181 | 51 | 28% | $49,773 | $275 |
| Paid search | 18 | 3 | 17% | $750 | $42 |

Meta spend for the identical window is **$9,482** against **560** platform-reported
leads. CRM count for the same window is 483 new + 38 existing = 521, a **93%**
reconciliation between two independent systems — the strongest evidence the join is
sound.

Derived: **CPL $20, cost per showed patient $263, 30-day ROAS 2.5×.**

Website leads convert at ~4× paid social's rate and are worth ~5.6× per lead. This
holds on the uncontrolled 90-day view too (27% vs 8%), so it is not a maturation
artifact.

## Accuracy ceiling — read before quoting any number above

**Match rate is ~30%, and it has been verified as real.** Of 3,386 GHL leads in the
last 90 days, 848 match a patient record by phone and 670 by email. The obvious
worry is that "never converted" is indistinguishable from "match failed."

**Measured 2026-08-10:** 60 unmatched leads (aged 30–90 days, named) were fuzzy-
matched against `mb_clients_cache` on surname + first-name prefix and on last-7
phone digits. Four candidates surfaced; on inspection two were different people
(*tammy johnson* vs *Tamika Johnson*, *erin taylor* vs *Erica Taylor*). **True
false-negative rate ≈ 2/60 (3%); ≤ 7% even counting every candidate as a miss.**

Consequence: the strict phone-and-email join is sound, and ~70% of leads genuinely
never become patients — ordinary for paid lead-gen. Conversion figures are
understated by a few percent, **not by a factor**, so absolute levels ($275/lead,
7% show rate, $263 per showed patient) can be quoted, not merely ranked.

Residual caveats: at n=60 the true rate could be as high as ~10%; and leads carrying
neither phone nor email can never match at all (one sampled lead, Karen Romero, had
no phone stored). Re-run the check if the join logic changes.

**The baseline table groups by GHL's `source` string, not `attributionSource`.**
That mismatch is why `(blank)` holds 376 leads: those contacts carry no `source`
value but many do carry full native attribution.

> **Superseded 2026-08-12.** An earlier revision of this spec required grouping by
> `attributionSource` *instead of* `source`. That instruction was wrong and would
> have destroyed the Website channel. See "Implementation, 2026-08-12" below for
> the measured correction and the new baseline.

## Coverage against Emily's taxonomy

Delivered: Website, Paid Search (n=18, below reporting threshold), Paid Social (her
list omits it; it is the largest source by volume), Call-in (partial — first-time
callers only, live 2026-08-09).

**Not delivered: Email, Walk-in, Referral.** Email has no capture mechanic at all.
Walk-in and referral are structurally invisible to GHL because those people never
submit a form.

Her three metrics: **Booking Rate** is computable. **Lead-to-Sale** is computable.
**Consult Show Rate is only partially available** — `session_type_name` is populated
on 100% of Zenoti appointments (2,009) and 0% of MindBody's (19,772), so consults
are separable from treatments only from July 2026 forward. Earlier periods support
"showed", not "showed for a consult".

## Patient-declared source — a second system, currently dead

`mb_clients_cache.referred_by` is self-reported at intake rather than inferred, so
it reaches the walk-in and referral population GHL structurally cannot see. It is
the only cross-check available on channel mix.

**It stopped working in April 2026.** Fill rate by acquisition month:

```
2025-06 … 2026-03   74–97%   healthy
2026-04             22%      collapse begins
2026-05 onward       0%      dead
2026-07 (Zenoti)     0%      migration did not restore it
```

The break predates the Zenoti migration (July) by two months, so the migration is
not the cause — it locked in a failure that began at the front desk in April.

**Two independent breaks; fixing either alone changes nothing.**

1. **Collection.** 0 of 39 sampled Zenoti guests carry any referral data. The
   `referral` field exists on the Zenoti guest object; nothing populates it. Check
   first whether the referral prompt was ever configured in Zenoti's guest-creation
   flow — if not, this is a settings fix, not a training problem.
2. **Transport.** `src/lib/integrations/zenoti-sync.ts:189` writes `referred_by`
   as a hardcoded `''` on every guest insert. Even with collection restored, nothing
   would reach the database.

### Use the healthy window only

Any analysis of this column must be restricted to **2025-06-01 → 2026-04-01**.
Spanning the dead period silently mixes real zeros with missing data — a 12-month
read put `(blank)` at 57% and Facebook at 7%; the healthy window puts `(blank)` at
15% and Facebook at 18%.

Paying new patients acquired in the healthy window (n=878):

| Source | Patients | Share | Revenue | Rev/patient |
|---|---|---|---|---|
| Google | 426 | 49% | $671,025 | $1,575 |
| Facebook | 155 | 18% | $195,827 | $1,263 |
| (blank) | 133 | 15% | $195,514 | $1,470 |
| Website | 113 | 13% | $177,550 | $1,571 |
| Another Client | 24 | 3% | $27,570 | $1,149 |
| Instagram | 18 | 2% | $41,965 | $2,331 |

These are **lifetime** revenue figures and are not comparable to the 30-day
windows in the baseline table above.

**Google at 49% of new paying patients, against 18 paid-search leads in 90 days,**
strongly suggests patients saying "Google" mean organic search / Maps / GBP, not
Google Ads. Self-report is last-touch memory, so paid social is likely undercounted
here — but not by the margin the raw numbers imply. Treat this as the strongest
available signal that organic discovery is underweighted relative to paid social,
and as a reason not to cut paid social on show rate alone.

## Honesty requirements in the UI

- **Revenue is associated, not caused.** No holdout exists, so this ranks sources; it
  does not prove incrementality. Label it "revenue within 30 days of lead", never
  "revenue generated".
- **Suppress rows below n=30.** Paid search (n=18) must not render a rate.
- **30-day revenue understates lifetime value** for a med spa. State the window on
  the view so a 2.5× ROAS is not read as the whole return.
- **Call-in counts first-time callers only.** Label accordingly.

## Explicitly not building

- Lead-stage tracking from the Leads Pipeline (stale by 97 days; see above).
- Walk-in and referral *capture* — no mechanic exists in GHL. Prospective capture
  needs front-desk stamping at Zenoti check-in: a training change, not a config
  change. (Retrospectively, `referred_by` covers part of this — see above.)
- Email as a lead source — no capture mechanic exists.
- Incrementality / lift. Needs a holdout design, out of scope here.

## Open questions

1. Does the `(blank)` bucket shrink once call-in stamping has run a full month? It
   was 42% unresolved, 27% hand-created in the CRM, 11% Instagram DM. If it stays
   large, the remainder needs its own capture mechanic.
2. Should spend be persisted daily into `ad_metrics_daily` (currently 0 rows) rather
   than fetched live? Live calls make historical cohorts unreproducible once
   attribution windows shift.
3. ~~True false-negative match rate?~~ **Resolved 2026-08-10: ≈3%** (see Accuracy
   ceiling). No longer a material uncertainty.
4. ~~Does patient-declared `referred_by` agree with observed channel mix?~~
   **Partially answered 2026-08-10:** it disagrees materially — Google 49% of paying
   patients vs 18 paid-search leads; Facebook 18% of paying patients vs the largest
   lead source by volume. Most likely explanation is that "Google" means organic
   discovery and that self-report is last-touch. Cannot be settled further until
   collection is restored.
5. What changed at the front desk in April 2026? The answer determines whether
   restoring capture is a Zenoti settings change or a training change. Until it is
   restored, no channel-mix question can be answered for any period after
   2026-03-31 — including the periods current spend decisions are being made on.

## Implementation, 2026-08-12

### Correction: neither field is correct alone

The earlier rule ("group by `attributionSource`, not `source`") was tested against
live data and **fails for the highest-value channel**. Measured n=60 per bucket:

| GHL `source` | What native attribution reports |
|---|---|
| `Website` | **53/60 → `CRM Workflows` / medium `Manual`** · 4 Paid Social · 2 Other · 1 Organic |
| `Facebook` | 58/60 → `Paid Social` / facebook + form · 1 CRM Workflows · 1 Social media |
| `chat widget` | 28 Organic Search · 18 Direct · 10 Social media · 3 Paid Search · 1 Referral |

Native attribution is *worse* for Website (it reports a non-channel), *far better*
for chat widget (it resolves one flat label into five real channels), and
equivalent for Facebook. So the resolver is a precedence hybrid, implemented in
`src/lib/attribution.ts`:

1. Paid-ad signal in attribution (`formName` + facebook/instagram medium, or a real
   `utmSource`) → `Paid Social` / `Paid Search`
2. Meaningful first-party `source` (`Website`, `Call-In`, `Google Ads – *`,
   consult/landing-page forms) → trust it
3. Real web channel in attribution (`Organic Search`, `Direct traffic`,
   `Social media`, `Referral`) → use it — this is what rescues chat widget
4. Otherwise → `Other` (attribution present but empty) or `Unattributed`

`chat widget` and `Facebook` are deliberately excluded from rule 2's trust list.

### `Other` is a genuine dead end

62 of 69 sampled `Other` rows are literally `{"sessionSource":"Other","medium":"other"}`
— no utmSource, referrer, form, or ad. There is nothing to recover; it is not a
parsing gap. It must stay visible as its own bucket rather than being folded away.

### Data pipeline

The contacts sync runs on the **v1 JWT API, which never returns `attributionSource`**.
Added `ghl_contacts_map.attribution_source JSONB` + `attribution_synced_at`, populated
by `scripts/backfill_attribution.mjs` via the v2 single-contact GET (no bulk endpoint
exists; one request per contact, ~11 min for 5,012 contacts over 120 days).
Coverage: **4,864 of 5,012 (97%)**, 11 failures.

Raw blobs are stored and the channel is resolved at read time, so changing the
resolver never requires re-running the backfill.

**Trap, hit and fixed:** `sql.json(attr)` *double-encoded* the blob — 4,228 rows
stored `jsonb_typeof = 'string'`, making `->>'sessionSource'` NULL and inflating
`Unattributed` to 914. This is the same class of bug as `items_json` and
`ghl_contacts_map.tags`, but note the fix is the **opposite** of what the tags note
says: pass the object directly, do not wrap in `sql.json()`. The backfill now
self-checks for the regression.

### Re-baseline (leads 30-90 days old, 30 days to convert)

| Source | New leads | Showed | Show rate | Revenue | Rev/lead |
|---|---|---|---|---|---|
| Paid Social | 507 | 42 | 8% | $27,732 | $55 |
| Other | 323 | 38 | 12% | $34,151 | $106 |
| Social Media | 142 | 1 | 1% | $670 | $5 |
| Website | 141 | 50 | **35%** | $55,465 | **$393** |
| Unattributed | 51 | 19 | 37% | $29,877 | $586 |
| Organic Search | 24 | 3 | n<30 | $1,294 | — |
| Paid Search | 19 | 4 | n<30 | $1,109 | — |
| Direct | 9 | 0 | n<30 | $0 | — |
| **Total** | **1,216** | **157** | **13%** | **$150,297** | |

Reconciliation against the 2026-08-10 baseline: Paid Social 507 vs 483 and Paid
Search 19 vs 18 both hold. **`(blank)` 376 → `Unattributed` 51, an 86% reduction** —
the goal of the exercise. Website fell 181 → 141 because rule 1 correctly reclaims
the ~4% of "Website" contacts that were really paid-social leads; its show rate rose
28% → 35% and rev/lead $275 → $393, strengthening the original conclusion that
Website is the most valuable channel by a wide margin.

**New and worth investigating: `Social Media` — 142 leads, 1 show, $670.** Almost
certainly Instagram DM traffic. If real, it is the worst-converting source measured
and consumes staff time.

### Shipped

- `src/lib/attribution.ts` — channel resolver
- `src/lib/lead-sources.ts` — funnel query enforcing all five rules
- `src/app/api/lead-sources/route.ts` — admins see revenue, others volumes only
- `src/app/(dashboard)/lead-sources/page.tsx` — own page, nav item "Lead Sources"
- `scripts/backfill_attribution.mjs` — resumable backfill
- `scripts/debug/verify_lead_sources.mjs` — re-baseline harness (duplicates the SQL;
  delete once the page is trusted)

### Still open

- Sync change: new contacts get no attribution until the backfill is re-run. The v1
  sync cannot supply it, so either a v2 path or a nightly incremental backfill is
  needed.
- Spend / CPL / cost-per-showed columns are **not** wired up yet — `ad_metrics_daily`
  is still 0 rows and spend is fetched live.
- `referred_by` panel not built.

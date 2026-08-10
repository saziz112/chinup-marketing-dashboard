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
- **Open defect, not blocking:** the `All Locations - Filler $100 OFF Form`
  (created 13 Jul) was never field-mapped in the Decatur sub-account. Decatur
  receives 0 of that form's leads while Kennesaw and Smyrna receive 9 each; Decatur
  leads both April forms (106 Botox, 58 Microneedling), so the sub-account is
  healthy and one form was missed. Four weeks of Decatur's share of that offer are
  lost. Three identified leads need working by hand.

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
This spec requires the latter. That mismatch is why `(blank)` holds 376 leads: those
contacts carry no `source` value but many do carry full native attribution.
Implementing per spec will shrink `(blank)` and move leads into named channels, so
the table above **understates named sources and overstates `(blank)`.** Re-baseline
after implementation.

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

## Unused asset: patient-declared source

`mb_clients_cache.referred_by` is populated for **5,342 of 7,674 patients** and is
self-reported at intake rather than inferred:

```
Google 2,482 · Facebook 779 · Website 513 · Another Client 277
Instagram 230 · Botox Ad 70 · Groupon 57 · ClassPass 46
```

This is a second, independent source system. It partially fills the Referral gap
("Another Client", 277) and reaches the walk-in population GHL cannot see. It also
serves as a cross-check on channel mix: if patients self-report Google far more than
Facebook while spend says otherwise, that divergence is itself a finding. Not yet
joined into the view — worth doing before concluding any channel is
under-performing.

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
4. Does patient-declared `referred_by` agree with observed channel mix? Disagreement
   would mean either attribution or self-report is systematically wrong, and which
   one matters before spend decisions are made on this data.

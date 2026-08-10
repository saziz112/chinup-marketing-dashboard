# Campaign Scoreboard (PLAN item 21) — Design

**Date:** 2026-08-09
**Status:** Approved, not yet implemented

## Problem

Campaign sends are logged, but nobody can answer "did that campaign work?" The
existing "Who Came Back" report gets partway: per segment and variant, it shows the
share of messaged patients who booked *or* attended within 30 days, messaged vs
holdout. It does not separate booking from attendance, carries no revenue, and has
no time window — a segment running since March reads the same whether it worked
last week or last spring.

## Correction to PLAN.md

Item 21 is recorded as "BLOCKED on lift-instrumentation redesign." That was written
2026-07-15. Commit `52f9350` (2026-07-16) fixed the holdout inflation on both sides:
write-side logs each control once, read-side dedups to one observation per
(segment, patient). Lift is no longer categorically blocked — it is gated on sample
size. The blocker note is stale and this spec supersedes it.

## Scope

Extend `/api/attribution/ghl-reactivation/conversions` and its Campaigns-tab table.
No new page, no second reporting concept.

### Funnel stages

| Stage | Definition |
|---|---|
| sent | `campaign_contacts.status = 'sent'` (excludes `failed`) |
| booked | appointment with status `Booked` / `Confirmed` in window |
| showed | appointment with status `Completed` / `Arrived` in window |
| revenue | treatment sales in window (see below) |

`booked` and `showed` are currently collapsed into a single "came back" flag.
Splitting them is the bulk of the query work.

**Replies are out of scope.** Reply data exists only in GoHighLevel — there is no
conversations table in Postgres — so computing it means an API call per patient
across ~2,900 patients in three locations, inside Vercel's 60s limit. Bookings are
the outcome that matters and are measurable today. If replies are wanted later they
need their own chunked backfill, as a separate item.

### Revenue

Sum `mb_sales_history` line items in the 30-day post-send window, filtered through
`normalizeTreatment()` so retail skincare, B12, fees, tips, and consults are
excluded. This matches how the segments themselves define a treatment, so the
scoreboard measures what the campaign targeted.

Report **total and median per patient — never mean.** At these volumes a single
$1,200 filler patient moves a segment's average materially.

### Window selector

30 / 90 / all-time, applied to the send date. Default 90.

### Holdout and honesty

Only `maintenance` has a control arm (~285 holdout patients vs ~837 messaged). Lift
extends to every stage including revenue, keeping the existing ≥30-per-arm gate, so
it stays blank until trustworthy.

The five segments without a control arm render **no** holdout columns and carry a
visible "no control group — descriptive only" label. Not a footnote. Without it a
16% booking rate on lapsed-vip reads as "the campaign produced 16%," when some of
those patients were returning anyway.

### Identity

Unchanged: the existing SHA-256 hash→client_id bridge, which unifies a patient's
MindBody and Zenoti identities via shared phone/email.

## Explicitly not building

- Per-run rows. 158 runs, median ~8 sends each; most rows would be too small to
  read, and a scoreboard of 3-patient rows invites exactly the over-interpretation
  the holdout gate exists to prevent.
- Reply tracking (see above).
- Any lift number for a segment with no control arm.

## Open question to resolve during implementation

`no-show-recovery` shows 13 sends across 11 runs (2026-07-16 → 08-04) despite
PLAN.md recording the campaign as inert and never sent. These are most likely Sam's
test sends. Confirm before the segment is scored — at that sample size, test sends
would make the numbers fiction.

## Data reference (as of 2026-08-09)

| Segment | Runs | Sent | First → last run |
|---|---|---|---|
| lapsed-winback | 12 | 1,244 | 2026-03-12 → 05-05 |
| lapsed-vip | 40 | 1,039 | 2026-03-24 → 08-07 |
| maintenance | 72 | 837 | 2026-05-30 → 08-04 |
| consult-only | 20 | 436 | 2026-03-12 → 08-04 |
| lapsed-long | 3 | 385 | 2026-04-27 |
| no-show-recovery | 11 | 13 | 2026-07-16 → 08-04 |

Holdout patients (maintenance only): ~144 email, ~141 SMS.
Rows carrying `variant_id`: 712.

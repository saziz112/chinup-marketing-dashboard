---
type: memory
workspace: Marketing Dashboard (Chin Up Aesthetics)
last_verified: 2026-06-12
refresh: after each shipped session — pull `git log` since last_verified and update Recent + Open threads
---

# Marketing Dashboard — Current State

Patient-marketing automation dashboard for Chin Up Aesthetics (campaigns, scheduled publishing, Google Ads, conversation analysis). **This repo (`~/dev/chinup/marketing-dashboard`) is canonical** — code moved out of iCloud 2026-06-05. The `Documents/01_Business/.../Marketing Dashboard` folder is reference/assets only.

## Stack
Next.js 16.1.6 (App Router) · React 19 · TS · Tailwind v4 · NextAuth (bcryptjs) · Vercel Postgres + Vercel Blob · Google Ads API (`google-ads-api`) + `googleapis` · recharts. Deploy via **`/dash`** skill (direct pushes to main guarded). Dev: `npm run dev` → build check `npm run build`. Env sync via `map_env.sh` / `push_env.sh`.

## Vercel cron jobs (`dashboard/vercel.json`)
- `/api/cron/publish-scheduled` — daily 07:00
- `/api/cron/analyze-conversations` — daily 11:00
- `/api/cron/sync-research` — daily 09:00
- `/api/cron/google-offline-conversions` — daily 10:00

## Recent (2026-05-29/30)
- **Maintenance Due campaign** shipped: data-driven cadence targeting (sourced from sales — appointments have no names), segment + cooldown + branded templates, per-location call/text number + one-tap SMS + real booking link, **12% holdout + instrumentation for lift measurement**.
- Treatment normalizer finalized: split Sculptra into its own category, Filler → Dermal Filler, fixed LHR exclusion + Profile Balancing mapping.
- Removed cancelled/no-show segment — **no cancellation data available** from Mindbody (same V6 limitation as the bonus dashboard).
- Fixed pg-cache double-encoding (arrays stored as jsonb strings).

## Open threads
- Maintenance Due lift measurement is **instrumented but unread** — check the 12% holdout vs treated once enough cycles elapse.
- Reminder-text routing keys on `mindbody_client_id` (email fallback + placeholder guards).

# Google Ads → Zenoti Revenue Attribution: Setup Guide

This is the **non-code work** Sam needs to complete in three external UIs (Google Ads, GHL, Google Tag Manager) so paid Zenoti visits flow back into Google Ads as offline conversions.

What gets uploaded: one conversion per patient per paid visit-day (Zenoti closed invoices, summed; $0 package-redemption days skipped), timed 11:59:59 PM Eastern on the visit date, only when the visit is on or after the day the gclid was captured and within 89 days of it. Daily at 10:00 UTC, after the Zenoti sync.

Plan reference: `/Users/samaziz/.claude/plans/memoized-snacking-cascade.md`.

Total user time: ~30 minutes.

---

## Step 1 — Create the "Paid Visit (Zenoti)" conversion action in Google Ads

**Where:** `https://ads.google.com/` → wrench icon (top-right) → **Goals** → **Conversions** → **+ New conversion action** button.

**Steps:**

1. Choose conversion type: **Import**
2. Source: **Other data sources or CRMs**
3. Track conversions from: **Clicks**
4. Click **Continue**

**Configure the action:**

| Field | Value |
|---|---|
| Name | `Paid Visit (Zenoti)` |
| Category | `Purchase` |
| Value | `Use different values for each conversion` |
| Default value | `0` (only used as fallback) |
| Count | `Every` (each paid visit inside the window is real revenue) |
| Click-through conversion window | `90 days` |
| Attribution model | `Data-driven` (fallback to `Last click` if data-driven isn't available yet) |
| Include in "Conversions" column | ✅ Yes |

5. Click **Create and continue**, then **Done**

**Grab the Conversion Action ID:**

After creating, click into the new "Paid Visit (Zenoti)" action. The URL will look like:

```
https://ads.google.com/aw/conversions/customeractions/details?ocid=...&ctId=12345678901
```

The `ctId=...` value is the **Conversion Action ID**. Copy it.

**Add to Vercel env vars:**

In `https://vercel.com/sams-projects-685506f7/chinup-marketing-dashboard/settings/environment-variables`, add:

| Variable | Value |
|---|---|
| `GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID` | `12345678901` (the ctId from the URL) |

Apply to **Production** environment. Redeploy after saving (Vercel won't pick it up until next deploy).

---

## Step 2 — Add `gclid` custom field on GHL Contact

**Where:** `https://app.gohighlevel.com/` → switch to each location → Settings → Custom Fields → Contact

**Do this for each of the 3 locations** (Decatur, Smyrna/Vinings, Kennesaw):

1. Click **+ Add Field**
2. Configure:
   - **Field Label**: `gclid`
   - **Data Type**: `Text`
   - **Placeholder**: (leave blank)
3. Save

The field doesn't need to be exposed on any form — it's just a place GHL can hold the value if you want to populate it via workflow. The dashboard's tracking is independent (uses email as the key), but having the field in GHL makes manual lookup possible.

---

## Step 3 — Configure Google Tag Manager to capture gclid

**Where:** `https://tagmanager.google.com/` → workspace for container `GTM-P6ZGKP5`

### 3a. Create a URL Variable (reads `?gclid=` from the URL)

1. Click **Variables** in the left sidebar
2. Under **User-Defined Variables**, click **New**
3. Click the variable configuration box
4. Choose **URL**
5. Configure:
   - **Variable Name** (top): `Query - gclid`
   - **Component Type**: `Query`
   - **Query Key**: `gclid`
6. Click **Save**

### 3b. Create a Custom JavaScript Variable (persists gclid in sessionStorage)

1. Variables → **New**
2. Choose **Custom JavaScript**
3. Name: `gclid persisted`
4. Paste this code:

```javascript
function() {
  try {
    var fromUrl = {{Query - gclid}};
    if (fromUrl) {
      sessionStorage.setItem('chinup_gclid', fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem('chinup_gclid') || '';
  } catch (e) { return ''; }
}
```

5. Save

### 3c. Create a Custom HTML Tag (posts gclid+email to the dashboard on form submit)

1. Click **Tags** in the left sidebar → **New**
2. Choose **Custom HTML**
3. Name: `Chinup Dashboard - gclid capture`
4. HTML:

```html
<script>
  (function() {
    try {
      var gclid = {{gclid persisted}};
      if (!gclid) return;
      var email = document.querySelector('input[name="email"], input[type="email"]');
      if (!email || !email.value) return;
      var payload = JSON.stringify({
        gclid: gclid,
        email: email.value.toLowerCase().trim(),
        landing_url: location.href
      });
      var url = 'https://chinup-marketing-dashboard.vercel.app/api/track/gclid';
      if (navigator.sendBeacon) {
        // text/plain on purpose: Chrome throws on a cross-origin beacon with an
        // application/json Blob, and the try/catch below would hide it.
        navigator.sendBeacon(url, new Blob([payload], { type: 'text/plain' }));
      } else {
        fetch(url, { method: 'POST', headers: {'Content-Type': 'text/plain'}, body: payload, keepalive: true });
      }
    } catch (e) {}
  })();
</script>
```

5. Triggering → **+ New trigger**
6. Choose trigger type **Form Submission**
7. Trigger fires on: **All Forms** (the script checks for email + gclid before doing anything, so it's safe to fire broadly)
8. Save trigger, save tag

### 3d. Publish the GTM container

Top-right blue **Submit** button → name the version "Add gclid capture" → **Publish**.

---

## Step 4 — Verify the flow end to end

**4a. Test gclid capture (5 min):**

1. In a private/incognito browser, visit a landing page with a fake gclid:
   ```
   https://decatur-offers.chinupaesthetics.com/welcome-to-chin-up?gclid=TEST_GCLID_12345
   ```
2. Open DevTools → Application → Session Storage. You should see `chinup_gclid: TEST_GCLID_12345`.
3. Fill out the form with a test email (e.g., your own + `+gclid-test@gmail.com`) and submit.
4. Open DevTools → Network → look for a request to `chinup-marketing-dashboard.vercel.app/api/track/gclid`. Status should be `200`.
5. Verify in Postgres:
   ```sql
   SELECT * FROM gclid_captures WHERE email = 'your+gclid-test@gmail.com';
   ```
   Should show one row with `gclid = 'TEST_GCLID_12345'`.

**4b. Test the offline conversion upload (manual trigger):**

After at least one real paid Zenoti visit exists for a tracked email (the visit day must be over, and the Zenoti sync must have run), dry-run first. `validateOnly=1` asks Google to check the batch without importing anything, and the dashboard records nothing:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://chinup-marketing-dashboard.vercel.app/api/cron/google-offline-conversions?validateOnly=1"
```

If `errors` is empty, run it for real:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://chinup-marketing-dashboard.vercel.app/api/cron/google-offline-conversions
```

Expected response:
```json
{ "ok": true, "candidates": 1, "planned": 1, "uploaded": 1, "alreadyUploaded": 0, "failed": 0, "retry": 0, "skippedVisits": {}, "errors": [] }
```

`failed` rows are permanent (expired click, conversion before click, bad gclid) and are never re-sent. `retry` rows go again on the next run. A 502 means Google rejected the whole request; nothing was recorded, so the next run retries everything.

Then in Google Ads → Goals → Conversions → Paid Visit (Zenoti) → Diagnostics, and allow up to ~3 hours for stats to appear (longer for data-driven attribution). Conversions report on the date of the original click, not the upload date.

**4c. Verify dashboard ROAS column:**

After Step 4b succeeds, the Google Ads API will start returning real `conversions_value` for affected campaigns. The dashboard's `/ads` Google tab "ROAS" column will reflect Zenoti-matched revenue automatically.

---

## Step 5 — When everything looks correct, request Phase 5 cleanup

Once you've verified:
- gclids are flowing into `gclid_captures`
- offline conversions are uploading successfully
- Google Ads UI shows revenue against the Paid Visit (Zenoti) action
- Dashboard ROAS column matches Google Ads ROAS within ~10%

Tell Claude to **execute Phase 5** to delete the heuristic GHL→campaign matching code (~200 lines of `LOCATION_ALIASES`/`STOPWORDS`/`tokenize`/`findLocationCampaign`/`enrichGhlLeadsWithMindBodyAndCampaigns` in `google-ads.ts`). The dashboard will then read ROAS straight from Google Ads — no more guessing.

---

## Troubleshooting

**Q: GTM tag isn't firing on form submit.**
A: Check Tag Assistant (`https://tagassistant.google.com/`). Common cause: the landing-page form uses Ajax/SPA submission, not a real `<form>` submit event. Switch the trigger to **DOM Element clicked** or **Form Submission - Listen for form submit (capture)** instead.

**Q: `/api/track/gclid` returns 400.**
A: Check the request body. Most common: email or gclid is empty/missing. The endpoint validates email format and gclid length.

**Q: Offline conversion upload returns `"results": [null]` or `partialFailureError`.**
A: Google Ads couldn't match the gclid to a recorded click. Causes:
   - Click happened outside the 90-day window
   - gclid is malformed (test gclids like `TEST_GCLID_12345` will never match in production — only real gclids from Google Ads URL tracking)
   - Conversion datetime is before the click datetime

**Q: Dashboard ROAS still shows 0 after 24h.**
A: Google Ads API caches metrics. Bust the dashboard cache by redeploying, or wait up to 4 hours.

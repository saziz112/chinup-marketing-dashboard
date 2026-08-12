// Enrolls the 3 recovered Decatur lip-filler leads into
// "A. Decatur Lip Filler Lead Nurture".
//
// Context: these 3 submitted the "All Locations - Filler $100 OFF Form" on
// 5-7 Aug 2026 but never landed in the Decatur sub-account (they exist in
// Kennesaw + Smyrna). Contacts were re-created by hand on 11 Aug.
// The workflow triggers on "Facebook lead form submitted", so creating the
// contact does NOT start it -- it has to be enrolled explicitly.
//
// HELD OVERNIGHT deliberately: enrolling sends the first nurture SMS
// immediately. Run this during business hours only (TCPA quiet hours are
// 9pm-8am local). Confirm the workflow's quiet-hour setting first.
//
// Run:  node --env-file=.env.local scripts/debug/enroll_recovered_filler_leads.mjs

const PIT = process.env.GHL_PIT_DECATUR;
const H = {
  Authorization: `Bearer ${PIT}`,
  Version: '2021-07-28',
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

const WF = '193877be-dfea-48eb-97aa-43277440507a'; // A. Decatur Lip Filler Lead Nurture

const CONTACTS = [
  ['Tonya Martin', 'dU89x1dgVKKlLy7OWIhn'],
  ['Regina Mccoy', '4VbQcCowIe8nBjr7rSfg'],
  ['Grady Bland', 'L85ZWNgVae8gKGkQ1GXA'],
];

// GHL rejects a trailing "Z" -- it wants an explicit offset. -04:00 = EDT.
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const eventStartTime =
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
  `T${pad(d.getHours())}:${pad(d.getMinutes())}:00-04:00`;

const hour = d.getHours();
if (hour < 8 || hour >= 21) {
  console.error(`REFUSING: local time is ${pad(hour)}:${pad(d.getMinutes())} — inside TCPA quiet hours (9pm-8am).`);
  console.error('Re-run during business hours, or comment out this guard if you know what you are doing.');
  process.exit(1);
}

for (const [name, id] of CONTACTS) {
  const r = await fetch(
    `https://services.leadconnectorhq.com/contacts/${id}/workflow/${WF}`,
    { method: 'POST', headers: H, body: JSON.stringify({ eventStartTime }) },
  );
  const body = await r.text();
  console.log(`${name}: ${r.status} ${body.slice(0, 200)}`);
}

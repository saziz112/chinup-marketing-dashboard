// READ-ONLY probe: what attribution data does GHL actually expose per contact?
const PIT = process.env.GHL_PIT_DECATUR;
const LOC = process.env.GHL_LOCATION_ID_DECATUR;
const H = { Authorization: `Bearer ${PIT}`, Version: '2021-07-28', Accept: 'application/json' };

const res = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${LOC}&limit=25`, { headers: H });
if (!res.ok) { console.log('HTTP', res.status, (await res.text()).slice(0, 300)); process.exit(1); }
const { contacts = [] } = await res.json();
console.log('contacts returned:', contacts.length);

const keys = new Set();
for (const c of contacts) Object.keys(c).forEach(k => keys.add(k));
console.log('\nALL FIELDS PRESENT ON CONTACT OBJECTS:\n ', [...keys].sort().join(', '));

console.log('\nPER-CONTACT ATTRIBUTION VIEW:');
for (const c of contacts.slice(0, 12)) {
    const a = c.attributionSource || {};
    const l = c.lastAttributionSource || {};
    console.log(` ${(c.dateAdded || '').slice(0, 10)} src=${JSON.stringify(c.source)}`);
    console.log(`   attributionSource: ${JSON.stringify(a)}`);
    if (Object.keys(l).length) console.log(`   lastAttribution:   ${JSON.stringify(l)}`);
    console.log(`   tags: ${JSON.stringify(c.tags || [])}`);
}
process.exit(0);

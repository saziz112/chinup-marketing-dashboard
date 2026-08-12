const PIT=process.env.GHL_PIT_DECATUR, LOC=process.env.GHL_LOCATION_ID_DECATUR;
const H={Authorization:`Bearer ${PIT}`,Version:'2021-07-28',Accept:'application/json'};
const l=await (await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${LOC}&limit=20`,{headers:H})).json();
for (const c of l.contacts.slice(0,6)) {
  const d=await (await fetch(`https://services.leadconnectorhq.com/contacts/${c.id}`,{headers:H})).json();
  const x=d.contact||{};
  console.log(`--- ${(x.dateAdded||'').slice(0,10)} source=${JSON.stringify(x.source)}`);
  console.log('  attributions:', JSON.stringify(x.attributions||[]).slice(0,500));
  console.log('  customFields:', JSON.stringify((x.customFields||[]).slice(0,4)));
}
process.exit(0);

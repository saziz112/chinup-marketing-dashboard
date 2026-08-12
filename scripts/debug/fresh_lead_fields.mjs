// READ-ONLY: dump every attribution-bearing field on one freshly-created contact.
const PIT=process.env.GHL_PIT_DECATUR, LOC=process.env.GHL_LOCATION_ID_DECATUR;
const H={Authorization:`Bearer ${PIT}`,Version:'2021-07-28',Accept:'application/json'};
const EMAIL=process.argv[2];

const cf=await (await fetch(`https://services.leadconnectorhq.com/locations/${LOC}/customFields`,{headers:H})).json();
const NAME=Object.fromEntries((cf.customFields||[]).map(f=>[f.id,f.name]));

const s=await (await fetch(`https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${LOC}&email=${encodeURIComponent(EMAIL)}`,{headers:H})).json();
const id=s.contact?.id;
if(!id){console.log('not found via duplicate search:',JSON.stringify(s).slice(0,300));process.exit(0);}
const {contact:c}=await (await fetch(`https://services.leadconnectorhq.com/contacts/${id}`,{headers:H})).json();

console.log('name       :',c.firstName,c.lastName);
console.log('created    :',c.dateAdded);
console.log('source     :',JSON.stringify(c.source));
console.log('attribution:',JSON.stringify(c.attributionSource||{}));
console.log('lastAttrib :',JSON.stringify(c.lastAttributionSource||{}));
console.log('tags       :',JSON.stringify(c.tags||[]));
console.log('\nCUSTOM FIELDS WITH VALUES:');
for(const f of (c.customFields||[])){
  const v=f.value??f.field_value;
  if(v===undefined||v===null||v==='') continue;
  console.log(`  ${(NAME[f.id]||f.id).padEnd(28)} = ${JSON.stringify(v)}`);
}
process.exit(0);

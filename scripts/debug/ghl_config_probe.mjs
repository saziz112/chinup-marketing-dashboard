const PIT=process.env.GHL_PIT_DECATUR, LOC=process.env.GHL_LOCATION_ID_DECATUR;
const H={Authorization:`Bearer ${PIT}`,Version:'2021-07-28',Accept:'application/json'};
const get=async(u)=>{const r=await fetch(u,{headers:H});return r.ok?r.json():{__err:r.status,__body:(await r.text()).slice(0,200)};};

console.log('=== CUSTOM FIELDS ===');
const cf=await get(`https://services.leadconnectorhq.com/locations/${LOC}/customFields`);
if(cf.__err) console.log(' err',cf.__err,cf.__body);
else for(const f of (cf.customFields||[])) console.log(` ${f.id}  ${String(f.name).padEnd(38)} ${f.dataType||''} ${f.fieldKey||''}`);

console.log('\n=== WORKFLOWS ===');
const wf=await get(`https://services.leadconnectorhq.com/workflows/?locationId=${LOC}`);
if(wf.__err) console.log(' err',wf.__err,wf.__body);
else for(const w of (wf.workflows||[])) console.log(` ${String(w.status).padEnd(9)} ${w.name}`);
process.exit(0);

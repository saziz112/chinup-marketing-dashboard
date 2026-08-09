import {createPool} from '@vercel/postgres';
const p=createPool({connectionString:process.env.SBNEW_POSTGRES_URL});
const r=await p.query(`select source, to_char(sale_date,'YYYY-MM') m, round(sum(total_amount)) rev, count(*) n
 from mb_sales_history where sale_date>='2026-01-01' group by 1,2 order by 2,1`);
for(const x of r.rows) console.log(x.m, String(x.source).padEnd(9), '$'+Number(x.rev).toLocaleString(), ' n='+x.n);
process.exit(0);

require('dotenv').config({ path: '.env.development.local' });
const { sql } = require('@vercel/postgres');

async function check() {
    try {
        const tables = await sql`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `;
        console.log("Tables in database:", tables.rows.map(r => r.table_name).join(', '));
        
        const usersCount = await sql`SELECT count(*) FROM users`;
        console.log("Users count:", usersCount.rows[0].count);
        
        const users = await sql`SELECT * FROM users LIMIT 10`;
        console.log("Users sample:");
        console.log(users.rows);
    } catch (e) {
        console.error("Error:", e.message);
    }
}
check().catch(console.error);

require('dotenv').config({ path: '.env.development.local' });
// Map prefixed Vercel Postgres variables to the standard ones expected by @vercel/postgres
Object.keys(process.env).forEach(key => {
    if (key.startsWith('MD__POSTGRES_') || key.startsWith('MD__PG') || key.startsWith('MD__DATABASE_')) {
        const standardKey = key.replace('MD__', '');
        process.env[standardKey] = process.env[key];
    }
});
const { sql } = require('@vercel/postgres');
const bcrypt = require('bcryptjs');

async function seed() {
    console.log('Starting User Seeding on New Database...');
    const adminHash = await bcrypt.hash('admin2026', 10);
    const managerHash = await bcrypt.hash('marketing2026', 10);

    const users = [
        {
            email: 'sam.aziz@chinupaesthetics.com',
            role: 'admin',
            staff_id: '100000000',
            hash: adminHash
        },
        {
            email: 'sharia.philadelphia@chinupaesthetics.com',
            role: 'marketing_manager',
            staff_id: '100000095',
            hash: managerHash
        }
    ];

    for (const user of users) {
        await sql`
            INSERT INTO users (email, password_hash, staff_id, role, must_change_password)
            VALUES (${user.email.toLowerCase()}, ${user.hash}, ${user.staff_id}, ${user.role}, TRUE)
            ON CONFLICT (email) DO NOTHING
        `;
        console.log(`Seeded ${user.email}`);
    }
    console.log('SUCCESS: Users seeded.');
}

seed().catch(e => console.error(e));

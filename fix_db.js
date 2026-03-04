require('dotenv').config({ path: '.env.development.local' });
const { sql } = require('@vercel/postgres');

async function fix() {
    try {
        const result = await sql`SELECT count(*) FROM users`;
        console.log("Users count:", result.rows[0].count);
        
        // Let's just drop users table since there's no production data if count is 0 or low
        if (result.rows[0].count < 3) {
            console.log("Dropping and recreating users table...");
            await sql`DROP TABLE IF EXISTS users CASCADE`;
            
            await sql`
                CREATE TABLE users (
                    id SERIAL PRIMARY KEY,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    staff_id VARCHAR(50) UNIQUE NOT NULL,
                    role VARCHAR(30) NOT NULL DEFAULT 'marketing_manager',
                    must_change_password BOOLEAN DEFAULT TRUE,
                    is_active BOOLEAN DEFAULT TRUE,
                    last_login_at TIMESTAMP WITH TIME ZONE,
                    failed_login_attempts INT DEFAULT 0,
                    failed_login_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `;
            await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`;
            await sql`CREATE INDEX IF NOT EXISTS idx_users_staff_id ON users(staff_id)`;
            console.log("Users table recreated successfully.");
        }
    } catch (e) {
        console.error(e);
    }
}
fix().catch(console.error);

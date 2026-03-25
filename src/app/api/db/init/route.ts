import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { seedUsers } from '@/lib/users';
import { initAllTables } from '@/lib/db';

/**
 * POST /api/db/init
 *
 * Initializes the database schema and seeds initial users.
 * This is a one-time setup endpoint.
 */
export async function POST() {
    try {
        console.log('[DB Init] Dropping existing users table if exists...');

        // Drop existing table to recreate with correct schema
        await sql`DROP TABLE IF EXISTS users CASCADE`;

        console.log('[DB Init] Creating users table with correct schema...');

        // Create users table with correct schema
        await sql`
            CREATE TABLE users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                display_name VARCHAR(100),
                password_hash VARCHAR(255) NOT NULL,
                staff_id VARCHAR(50) UNIQUE NOT NULL,
                role VARCHAR(50) NOT NULL,
                must_change_password BOOLEAN DEFAULT TRUE,
                is_active BOOLEAN DEFAULT TRUE,
                last_login_at TIMESTAMP,
                failed_login_attempts INTEGER DEFAULT 0,
                failed_login_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

        console.log('[DB Init] Users table created/verified');

        // Create all other tables (social, ads, reviews, sync tables, etc.)
        console.log('[DB Init] Creating all remaining tables...');
        await initAllTables();
        console.log('[DB Init] All tables created/verified');

        // Seed initial users (Sam + Sharia)
        console.log('[DB Init] Seeding initial users...');
        await seedUsers();

        console.log('[DB Init] Database initialization complete!');

        return NextResponse.json({
            success: true,
            message: 'Database initialized successfully. Default passwords set — change immediately via Settings.',
            users: [
                { email: 'sam.aziz@chinupaesthetics.com', role: 'admin' },
                { email: 'sharia@chinupaesthetics.com', role: 'marketing_manager' },
            ],
        });

    } catch (error: any) {
        console.error('[DB Init] Error:', error);
        return NextResponse.json({
            success: false,
            error: error.message,
            hint: 'Check Vercel Postgres connection and environment variables',
        }, { status: 500 });
    }
}

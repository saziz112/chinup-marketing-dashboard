/**
 * Users Database Module — Postgres-backed authentication
 * Simplified for 2 users: Admin (Sam) + Marketing Manager (Sharia)
 */

import { sql } from '@vercel/postgres';
import bcrypt from 'bcryptjs';
import { USERS } from '@/lib/config';

const SALT_ROUNDS = 10;

export interface UserRecord {
    email: string;
    staff_id: string;
    role: string;
    password_hash: string;
    must_change_password: boolean;
    is_active: boolean;
    last_login_at: string | null;
    failed_login_attempts: number;
    failed_login_at: string | null;
}

// --- Auth Queries ---

export async function getUserByEmail(email: string) {
    try {
        const { rows } = await sql`
            SELECT email, display_name, password_hash, staff_id, role, must_change_password, is_active
            FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
        `;
        return rows[0] || null;
    } catch {
        // Fallback if display_name column doesn't exist yet
        const { rows } = await sql`
            SELECT email, password_hash, staff_id, role, must_change_password, is_active
            FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
        `;
        return rows[0] || null;
    }
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
}

// --- Login Audit ---

export async function recordSuccessfulLogin(staffId: string) {
    await sql`
        UPDATE users
        SET last_login_at = CURRENT_TIMESTAMP,
            failed_login_attempts = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE staff_id = ${staffId}
    `;
}

export async function recordFailedLogin(email: string) {
    await sql`
        UPDATE users
        SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
            failed_login_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE LOWER(email) = LOWER(${email})
    `;
}

// --- Password Management ---

export async function updatePassword(staffId: string, newPassword: string) {
    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await sql`
        UPDATE users
        SET password_hash = ${hash},
            must_change_password = FALSE,
            updated_at = CURRENT_TIMESTAMP
        WHERE staff_id = ${staffId}
    `;
}

// --- Seeding ---

export async function seedUsers() {
    const adminHash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || 'admin2026', SALT_ROUNDS);
    const managerHash = await bcrypt.hash(process.env.SEED_MANAGER_PASSWORD || 'marketing2026', SALT_ROUNDS);

    for (const user of USERS) {
        const hash = user.role === 'admin' ? adminHash : managerHash;
        await sql`
            INSERT INTO users (email, display_name, password_hash, staff_id, role, must_change_password)
            VALUES (${user.email.toLowerCase()}, ${user.displayName}, ${hash}, ${user.id}, ${user.role}, TRUE)
            ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
        `;
    }
}

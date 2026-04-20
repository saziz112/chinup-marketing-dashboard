import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

async function checkAdmin() {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== 'admin') {
        return false;
    }
    return true;
}

// GET — List all users
export async function GET() {
    if (!(await checkAdmin())) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        // Self-migration: ensure display_name column exists before querying it
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(100)`.catch(() => {});
        await sql`UPDATE users SET display_name = 'Sam Aziz' WHERE email = 'sam.aziz@chinupaesthetics.com' AND display_name IS NULL`.catch(() => {});
        await sql`UPDATE users SET display_name = 'Sharia Philadelphia' WHERE email = 'sharia@chinupaesthetics.com' AND display_name IS NULL`.catch(() => {});

        const { rows } = await sql`
            SELECT id, email, display_name, staff_id, role, last_login_at, is_active, created_at, failed_login_attempts
            FROM users
            ORDER BY created_at ASC
        `;
        return NextResponse.json({ users: rows });
    } catch (e: any) {
        console.error('Error fetching users:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// POST — Add a new user
export async function POST(req: Request) {
    if (!(await checkAdmin())) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { email, staff_id, role } = await req.json();

        if (!email || !staff_id || !role) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const hash = await bcrypt.hash('chinup2026', SALT_ROUNDS);

        await sql`
            INSERT INTO users (email, password_hash, staff_id, role, must_change_password)
            VALUES (${email.toLowerCase()}, ${hash}, ${staff_id}, ${role}, TRUE)
        `;

        return NextResponse.json({ success: true });
    } catch (e: any) {
        console.error('Error adding user:', e);
        if (e.message?.includes('duplicate key')) {
            return NextResponse.json({ error: 'A user with that email or staff ID already exists.' }, { status: 409 });
        }
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

// DELETE — Remove a user
export async function DELETE(req: Request) {
    if (!(await checkAdmin())) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { id } = await req.json();
        await sql`DELETE FROM users WHERE id = ${id}`;
        return NextResponse.json({ success: true });
    } catch (e: any) {
        console.error('Error deleting user:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// PATCH — Reset password
export async function PATCH(req: Request) {
    if (!(await checkAdmin())) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { id, action } = await req.json();

        if (action === 'reset_password') {
            const hash = await bcrypt.hash('chinup2026', SALT_ROUNDS);
            await sql`
                UPDATE users 
                SET password_hash = ${hash}, must_change_password = TRUE, updated_at = CURRENT_TIMESTAMP
                WHERE id = ${id}
            `;
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (e: any) {
        console.error('Error in user action:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

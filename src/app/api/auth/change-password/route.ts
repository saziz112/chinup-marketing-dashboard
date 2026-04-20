import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { currentPassword, newPassword } = await req.json();
        const staffId = (session.user as any).staffId;

        if (!currentPassword || !newPassword) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        if (newPassword.length < 6) {
            return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
        }

        // Get current hash
        const { rows } = await sql`
            SELECT password_hash FROM users WHERE staff_id = ${staffId}
        `;

        if (rows.length === 0) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        // Verify current password
        const isValid = await bcrypt.compare(currentPassword, rows[0].password_hash);
        if (!isValid) {
            return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 });
        }

        // Update to new password
        const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
        await sql`
            UPDATE users 
            SET password_hash = ${newHash}, must_change_password = FALSE, updated_at = CURRENT_TIMESTAMP
            WHERE staff_id = ${staffId}
        `;

        return NextResponse.json({ success: true });
    } catch (e: any) {
        console.error('Error changing password:', e);
        return NextResponse.json({ error: 'An error occurred' }, { status: 500 });
    }
}

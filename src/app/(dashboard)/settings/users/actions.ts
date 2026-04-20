'use server';

import { sql } from '@/lib/db/sql';
import bcrypt from 'bcryptjs';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { revalidatePath } from 'next/cache';

const SALT_ROUNDS = 10;

async function checkAdmin() {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== 'admin') {
        throw new Error('Unauthorized');
    }
}

export async function getUsers() {
    await checkAdmin();
    const { rows } = await sql`
        SELECT id, email, staff_id, role, last_login_at, is_active, created_at, failed_login_attempts
        FROM users
        ORDER BY created_at DESC
    `;
    return rows;
}

export async function addUser(formData: FormData) {
    await checkAdmin();

    const email = formData.get('email') as string;
    const staffId = formData.get('staff_id') as string;
    const role = formData.get('role') as string;

    if (!email || !staffId || !role) {
        throw new Error('Missing required fields');
    }

    const hash = await bcrypt.hash('chinup2026', SALT_ROUNDS); // default password

    try {
        await sql`
            INSERT INTO users (email, password_hash, staff_id, role, must_change_password)
            VALUES (${email.toLowerCase()}, ${hash}, ${staffId}, ${role}, TRUE)
        `;
        revalidatePath('/settings');
        return { success: true };
    } catch (e: any) {
        console.error('Error adding user:', e);
        return { success: false, error: e.message };
    }
}

export async function deleteUser(id: number) {
    await checkAdmin();
    await sql`DELETE FROM users WHERE id = ${id}`;
    revalidatePath('/settings');
}

export async function resetUserPassword(id: number) {
    await checkAdmin();
    const hash = await bcrypt.hash('chinup2026', SALT_ROUNDS);
    await sql`
        UPDATE users 
        SET password_hash = ${hash}, must_change_password = TRUE
        WHERE id = ${id}
    `;
    revalidatePath('/settings');
}

export async function updateUserPassword(staffId: string, newPassword: string) {
    // Note: this is for a user changing their own password
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).staffId !== staffId) {
        throw new Error('Unauthorized');
    }

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await sql`
        UPDATE users 
        SET password_hash = ${hash}, must_change_password = FALSE
        WHERE staff_id = ${staffId}
    `;
}

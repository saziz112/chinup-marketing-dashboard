import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function GET() {
    const envVars = {
        POSTGRES_URL: process.env.POSTGRES_URL ? 'PRESENT (HIDDEN)' : 'MISSING',
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? 'PRESENT (HIDDEN)' : 'MISSING',
        NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'MISSING',
    };

    let dbStatus = 'UNKNOWN';
    let dbError = null;

    try {
        if (!process.env.POSTGRES_URL) {
            dbStatus = 'FAIL: POSTGRES_URL is missing';
        } else {
            await sql`SELECT 1`;
            dbStatus = 'CONNECTED';
        }
    } catch (err: any) {
        dbStatus = 'ERROR';
        dbError = err.message;
    }

    return NextResponse.json({
        status: 'diagnostic',
        envVars,
        dbStatus,
        dbError,
    });
}

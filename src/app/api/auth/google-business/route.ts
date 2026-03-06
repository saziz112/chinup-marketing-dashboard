/**
 * Google Business Profile OAuth Initiator
 * Redirects to Google consent screen with business.manage scope.
 * Uses the same client ID as Google Ads (same Google Cloud project).
 */

import { NextResponse } from 'next/server';

export async function GET() {
    const clientId = process.env.GBP_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID;
    if (!clientId) {
        return NextResponse.json({ error: 'GBP_CLIENT_ID not configured' }, { status: 503 });
    }

    // Construct callback URL — must match what's registered in Google Cloud Console
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3001';
    const redirectUri = `${baseUrl}/api/auth/google-business/callback`;

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/business.manage',
        access_type: 'offline',
        prompt: 'consent', // Force consent to get refresh token
    });

    return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

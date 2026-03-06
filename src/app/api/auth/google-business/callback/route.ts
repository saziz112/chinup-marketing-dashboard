/**
 * Google Business Profile OAuth Callback
 * Exchanges auth code for refresh token, then displays it for the user to copy.
 * Also auto-discovers the GBP account ID and location resource names.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
    const code = req.nextUrl.searchParams.get('code');
    const error = req.nextUrl.searchParams.get('error');

    if (error) {
        return new NextResponse(renderHTML('OAuth Error', `Google returned an error: ${error}`, null), {
            headers: { 'Content-Type': 'text/html' },
        });
    }

    if (!code) {
        return new NextResponse(renderHTML('Missing Code', 'No authorization code received from Google.', null), {
            headers: { 'Content-Type': 'text/html' },
        });
    }

    const clientId = process.env.GBP_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID!;
    const clientSecret = process.env.GBP_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET!;
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3001';
    const redirectUri = `${baseUrl}/api/auth/google-business/callback`;

    try {
        // Exchange code for tokens
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }).toString(),
        });

        if (!tokenRes.ok) {
            const errText = await tokenRes.text();
            return new NextResponse(renderHTML('Token Exchange Failed', errText, null), {
                headers: { 'Content-Type': 'text/html' },
            });
        }

        const tokenData = await tokenRes.json();
        const refreshToken = tokenData.refresh_token;
        const accessToken = tokenData.access_token;

        if (!refreshToken) {
            return new NextResponse(renderHTML(
                'No Refresh Token',
                'Google did not return a refresh token. Try revoking access at myaccount.google.com/permissions and re-authorizing.',
                null
            ), { headers: { 'Content-Type': 'text/html' } });
        }

        // Auto-discover account ID and locations
        let accountInfo = '';
        try {
            const accountsRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            if (accountsRes.ok) {
                const accountsData = await accountsRes.json();
                const accounts = accountsData.accounts || [];

                for (const account of accounts) {
                    const accountId = account.name?.replace('accounts/', '');
                    accountInfo += `\nGOOGLE_BUSINESS_ACCOUNT_ID=${accountId}  # ${account.accountName || 'N/A'}`;

                    // Discover locations
                    try {
                        const locRes = await fetch(
                            `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title,storefrontAddress`,
                            { headers: { 'Authorization': `Bearer ${accessToken}` } }
                        );
                        if (locRes.ok) {
                            const locData = await locRes.json();
                            const locations = locData.locations || [];
                            for (const loc of locations) {
                                const locId = loc.name?.split('/').pop();
                                const title = loc.title || 'Unknown';
                                const city = loc.storefrontAddress?.locality || '';
                                accountInfo += `\n# ${title} (${city})`;
                                accountInfo += `\n# Location ID: ${locId}`;
                            }
                        }
                    } catch {
                        accountInfo += '\n# Could not discover locations — you can find them manually in Google Business dashboard';
                    }
                }
            }
        } catch {
            accountInfo = '\n# Could not discover accounts — add GOOGLE_BUSINESS_ACCOUNT_ID manually';
        }

        const envVars = `GOOGLE_BUSINESS_REFRESH_TOKEN=${refreshToken}${accountInfo}`;

        return new NextResponse(renderHTML('Success', null, envVars), {
            headers: { 'Content-Type': 'text/html' },
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return new NextResponse(renderHTML('Error', msg, null), {
            headers: { 'Content-Type': 'text/html' },
        });
    }
}

function renderHTML(title: string, error: string | null, envVars: string | null): string {
    return `<!DOCTYPE html>
<html><head><title>GBP OAuth — ${title}</title>
<style>
    body { font-family: system-ui; background: #0A225C; color: #FEFEFE; padding: 40px; max-width: 700px; margin: 0 auto; }
    h1 { color: #D8B41D; }
    .box { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 20px; margin: 16px 0; }
    pre { background: #000; padding: 16px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; font-size: 13px; color: #34D399; }
    .error { color: #F87171; }
    a { color: #60A5FA; }
</style></head><body>
<h1>Google Business Profile OAuth</h1>
${error ? `<div class="box error"><p>${error}</p></div>` : ''}
${envVars ? `
<div class="box">
    <p>Add these to your <code>.env.local</code> and Vercel environment variables:</p>
    <pre>${envVars}</pre>
    <p>After adding, also set the location IDs for each Chin Up location:</p>
    <pre>GOOGLE_BUSINESS_LOCATION_DECATUR=locations/xxx
GOOGLE_BUSINESS_LOCATION_SMYRNA=locations/xxx
GOOGLE_BUSINESS_LOCATION_KENNESAW=locations/xxx</pre>
</div>
<p><a href="/">← Back to Dashboard</a></p>
` : ''}
</body></html>`;
}

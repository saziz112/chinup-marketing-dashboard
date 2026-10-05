/** Fails closed: no CRON_SECRET configured means no cron caller is trusted. */
export function isCronAuthorized(authHeader: string | null): boolean {
    const secret = process.env.CRON_SECRET;
    return !!secret && authHeader === `Bearer ${secret}`;
}

/**
 * /api/attribution/ghl-reactivation/conversions
 * GET: "Who came back" — for each logged campaign send, did that patient book or
 * attend an appointment within 30 days? Aggregated by segment and (when present)
 * by variant, split into messaged vs holdout.
 *
 * Read-only. Admin-only. Sends nothing.
 *
 * Join: campaign_contacts stores hashed phone/email (HIPAA-safe), not client_id.
 * hashPhone/hashEmail are deterministic SHA-256, so we rebuild a hash->client_id
 * bridge from mb_clients_cache in JS. Hashing phone/email also unifies a patient's
 * MindBody + Zenoti identities (they share a phone/email), so a booking under either
 * id counts.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';
import { hashPhone, hashEmail } from '@/lib/dnd-check';

// An appointment in this window counts as "came back" (booked or attended).
// NoShow / cancelled are excluded — those aren't a return visit.
const CONV_STATUSES = new Set(['Completed', 'Arrived', 'Booked', 'Confirmed']);
const WINDOW_DAYS = 30;

type Bucket = { sent: number; sentConv: number; hold: number; holdConv: number };
const newBucket = (): Bucket => ({ sent: 0, sentConv: 0, hold: 0, holdConv: 0 });

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if ((session.user as Record<string, unknown>).isAdmin !== true) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    try {
        // variant_id is added by the send path's self-migration; may not exist yet.
        const hasVariant = (await sql`
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'campaign_contacts' AND column_name = 'variant_id'
        `).rows.length > 0;

        // Nested sql fragments aren't composable through the db shim (it resolves to a
        // Promise, not a fragment), so branch into two complete queries.
        const contacts = (hasVariant
            ? await sql`
                SELECT cc.contact_id, cc.phone_hash, cc.email_hash, cc.sent_at, cc.holdout, cc.channel,
                       cc.variant_id, r.segment, r.segment_label
                FROM campaign_contacts cc
                JOIN campaign_runs r ON r.run_id = cc.run_id
                WHERE cc.status IN ('sent', 'holdout')`
            : await sql`
                SELECT cc.contact_id, cc.phone_hash, cc.email_hash, cc.sent_at, cc.holdout, cc.channel,
                       NULL AS variant_id, r.segment, r.segment_label
                FROM campaign_contacts cc
                JOIN campaign_runs r ON r.run_id = cc.run_id
                WHERE cc.status IN ('sent', 'holdout')`
        ).rows as Array<{
            contact_id: string | null; phone_hash: string | null; email_hash: string | null; sent_at: string;
            holdout: boolean; channel: string; variant_id: string | null;
            segment: string; segment_label: string;
        }>;

        if (contacts.length === 0) {
            return NextResponse.json({
                generatedAt: new Date().toISOString(), windowDays: WINDOW_DAYS,
                hasVariantData: false, totalSends: 0, matchRate: 0, segments: [],
            });
        }

        const earliest = contacts.reduce((m, c) => c.sent_at < m ? c.sent_at : m, contacts[0].sent_at);

        // Build hash -> client_id bridge
        const clients = (await sql`SELECT client_id, phone, email FROM mb_clients_cache`).rows as
            Array<{ client_id: string; phone: string | null; email: string | null }>;
        const phoneToIds = new Map<string, Set<string>>();
        const emailToIds = new Map<string, Set<string>>();
        for (const cl of clients) {
            if (cl.phone) {
                const h = hashPhone(cl.phone);
                (phoneToIds.get(h) ?? phoneToIds.set(h, new Set()).get(h)!).add(cl.client_id);
            }
            if (cl.email) {
                const h = hashEmail(cl.email);
                (emailToIds.get(h) ?? emailToIds.set(h, new Set()).get(h)!).add(cl.client_id);
            }
        }

        // Collapse to ONE observation per (segment, patient). The send path re-logs
        // holdout (and failed) patients on every daily cron run, so a single control
        // patient accumulates ~10 rows while messaged patients (entering a cooldown)
        // do not — counting rows instead of patients inflated the holdout denominator
        // ~10x. Dedup by contact_id, keep the earliest send, union all phone/email
        // hashes, and OR the holdout flag.
        type Obs = {
            segment: string; label: string; sentAt: string; holdout: boolean;
            variantId: string | null; phoneHashes: Set<string>; emailHashes: Set<string>;
        };
        const obsByKey = new Map<string, Obs>();
        for (const c of contacts) {
            const patientKey = c.contact_id || c.phone_hash || c.email_hash || '';
            const key = `${c.segment}|${patientKey}`;
            let o = obsByKey.get(key);
            if (!o) {
                o = {
                    segment: c.segment, label: c.segment_label, sentAt: c.sent_at,
                    holdout: c.holdout, variantId: c.variant_id,
                    phoneHashes: new Set(), emailHashes: new Set(),
                };
                obsByKey.set(key, o);
            }
            if (c.sent_at < o.sentAt) { o.sentAt = c.sent_at; o.variantId = c.variant_id; }
            o.holdout = o.holdout || c.holdout;
            if (c.phone_hash) o.phoneHashes.add(c.phone_hash);
            if (c.email_hash) o.emailHashes.add(c.email_hash);
        }
        const observations = [...obsByKey.values()];

        // Resolve each observation to its set of client_ids
        let matched = 0;
        const resolved = observations.map(o => {
            const ids = new Set<string>();
            for (const h of o.phoneHashes) for (const id of phoneToIds.get(h) ?? []) ids.add(id);
            for (const h of o.emailHashes) for (const id of emailToIds.get(h) ?? []) ids.add(id);
            if (ids.size) matched++;
            return { o, ids };
        });

        // Load appointments for matched clients from the earliest send onward
        const allIds = [...new Set(resolved.flatMap(r => [...r.ids]))];
        const appts = allIds.length ? (await sql`
            SELECT client_id, start_date, status FROM mb_appointments_history
            WHERE client_id = ANY(${allIds}) AND start_date >= ${earliest}
        `).rows as Array<{ client_id: string; start_date: string; status: string }> : [];
        const apptsByClient = new Map<string, Array<{ d: number; status: string }>>();
        for (const a of appts) {
            (apptsByClient.get(a.client_id) ?? apptsByClient.set(a.client_id, []).get(a.client_id)!)
                .push({ d: +new Date(a.start_date), status: a.status });
        }

        // Aggregate: segment -> bucket, and segment|variant -> bucket. One patient = one count.
        const segAgg = new Map<string, { label: string; bucket: Bucket; variants: Map<string, Bucket> }>();
        for (const { o, ids } of resolved) {
            const sentAt = +new Date(o.sentAt);
            const windowEnd = sentAt + WINDOW_DAYS * 864e5;
            let converted = false;
            for (const id of ids) {
                for (const a of apptsByClient.get(id) ?? []) {
                    if (a.d >= sentAt && a.d <= windowEnd && CONV_STATUSES.has(a.status)) { converted = true; break; }
                }
                if (converted) break;
            }
            const entry = segAgg.get(o.segment) ??
                segAgg.set(o.segment, { label: o.label, bucket: newBucket(), variants: new Map() }).get(o.segment)!;
            const vKey = o.variantId || '(untagged)';
            const vBucket = entry.variants.get(vKey) ?? entry.variants.set(vKey, newBucket()).get(vKey)!;
            for (const b of [entry.bucket, vBucket]) {
                if (o.holdout) { b.hold++; if (converted) b.holdConv++; }
                else { b.sent++; if (converted) b.sentConv++; }
            }
        }

        const rate = (conv: number, n: number) => n ? +(100 * conv / n).toFixed(1) : null;
        const segments = [...segAgg.entries()]
            .map(([segment, e]) => ({
                segment, label: e.label,
                sent: e.bucket.sent, sentConversions: e.bucket.sentConv, sentRate: rate(e.bucket.sentConv, e.bucket.sent),
                holdout: e.bucket.hold, holdoutConversions: e.bucket.holdConv, holdoutRate: rate(e.bucket.holdConv, e.bucket.hold),
                lift: e.bucket.hold >= 30 && e.bucket.sent >= 30
                    ? +(((e.bucket.sentConv / e.bucket.sent) - (e.bucket.holdConv / e.bucket.hold)) * 100).toFixed(1)
                    : null,
                variants: [...e.variants.entries()].map(([variantId, b]) => ({
                    variantId, sent: b.sent, sentConversions: b.sentConv, sentRate: rate(b.sentConv, b.sent),
                    holdout: b.hold, holdoutConversions: b.holdConv, holdoutRate: rate(b.holdConv, b.hold),
                })).sort((a, z) => z.sent - a.sent),
            }))
            .sort((a, z) => z.sent - a.sent);

        return NextResponse.json({
            generatedAt: new Date().toISOString(),
            windowDays: WINDOW_DAYS,
            hasVariantData: hasVariant && observations.some(o => o.variantId),
            totalSends: observations.filter(o => !o.holdout).length,
            matchRate: observations.length ? +(100 * matched / observations.length).toFixed(0) : 0,
            segments,
        });
    } catch (error) {
        console.warn('[campaign-conversions] Error:', error);
        return NextResponse.json({ error: 'Failed to compute conversions' }, { status: 500 });
    }
}

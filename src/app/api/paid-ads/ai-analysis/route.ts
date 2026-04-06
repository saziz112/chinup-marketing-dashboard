/**
 * POST /api/paid-ads/ai-analysis
 * AI-powered campaign analysis using Claude Haiku.
 * Accepts campaign metrics, benchmarks, ad copy, and appointment data.
 * Returns grade (A-F), priority actions, and creative suggestion.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const maxDuration = 30;

interface AnalysisRequest {
    campaignName: string;
    platform: 'meta' | 'google';
    metrics: {
        ctr: number;
        cpm: number | null;
        cpc: number | null;
        costPerResult: number | null;
        roas: number;
        impressions: number;
        clicks: number;
        results: number;
        spend: number | null;
    };
    benchmarkGrades: Record<string, { grade: string; label: string }>;
    adCopy?: { title?: string; body?: string; headlines?: string[]; descriptions?: string[] } | null;
    appointmentData?: { booked: number; completed: number } | null;
}

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
        }

        const body: AnalysisRequest = await request.json();
        const { campaignName, platform, metrics, benchmarkGrades, adCopy, appointmentData } = body;

        const platformLabel = platform === 'meta' ? 'Meta (Facebook/Instagram)' : 'Google';

        // Build the analysis prompt
        const gradeLines = Object.entries(benchmarkGrades)
            .map(([metric, g]) => `- ${metric}: ${g.grade} (${g.label})`)
            .join('\n');

        let adCopySection = '';
        if (adCopy) {
            const title = adCopy.title || adCopy.headlines?.join(' | ') || 'N/A';
            const bodyText = adCopy.body || adCopy.descriptions?.join(' | ') || 'N/A';
            adCopySection = `\nAd Creative:\n- Headline: ${title}\n- Body: ${bodyText}`;
        }

        let apptSection = '';
        if (appointmentData && appointmentData.booked > 0) {
            const showRate = appointmentData.booked > 0
                ? Math.round((appointmentData.completed / appointmentData.booked) * 100)
                : 0;
            apptSection = `\nAppointment Funnel:\n- Leads: ${metrics.results} → Booked: ${appointmentData.booked} → Completed: ${appointmentData.completed}\n- Booking Rate: ${metrics.results > 0 ? Math.round((appointmentData.booked / metrics.results) * 100) : 0}%\n- Show Rate: ${showRate}%`;
        }

        const prompt = `You are a paid advertising strategist for Chin Up! Aesthetics, a premium medical spa with 3 locations in metro Atlanta (Decatur, Smyrna, Kennesaw). Services include Botox, Dysport, fillers, HydraFacials, laser treatments, and body contouring.

Analyze this ${platformLabel} Ads campaign and provide specific, actionable recommendations.

Campaign: "${campaignName}"
Platform: ${platformLabel}

Performance Metrics:
- Impressions: ${metrics.impressions.toLocaleString()}
- Clicks: ${metrics.clicks.toLocaleString()}
- CTR: ${metrics.ctr.toFixed(2)}%
- Leads: ${metrics.results}
${metrics.spend !== null ? `- Spend: $${metrics.spend.toFixed(0)}` : ''}
${metrics.cpm !== null ? `- CPM: $${metrics.cpm.toFixed(2)}` : ''}
${metrics.costPerResult !== null ? `- Cost per Lead: $${metrics.costPerResult.toFixed(2)}` : ''}
- ROAS: ${metrics.roas.toFixed(1)}x

Benchmark Grades (vs. Med Spa Industry Average):
${gradeLines}
${adCopySection}
${apptSection}

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "grade": "A|B|C|D|F",
  "summary": "One sentence overall assessment",
  "priorityActions": ["action1", "action2", "action3"],
  "creativeSuggestion": "Specific ad copy improvement if creative was provided, otherwise null"
}

Rules:
- Be specific to med spa industry and this campaign's data
- Reference actual numbers from the metrics
- If CTR is poor, suggest audience or creative changes
- If CPM is high, suggest placement or targeting changes
- If Cost/Lead is high, suggest offer or landing page changes
- If ROAS is low, suggest budget reallocation or campaign restructuring
- If appointment show rate is low, suggest follow-up automation
- Keep each action to 1-2 sentences max`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 512,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Anthropic API error: ${response.status} — ${err}`);
        }

        const aiResponse = await response.json();
        const text = aiResponse.content?.[0]?.text || '{}';

        // Parse JSON from response (handle potential markdown fences)
        const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const analysis = JSON.parse(jsonStr);

        return NextResponse.json(analysis);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('/api/paid-ads/ai-analysis error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

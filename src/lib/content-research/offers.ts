/**
 * Chin Up offers the hook writer can start from. Every price here is copied
 * from a named SamOS wiki page; none are invented. Prices change monthly, so
 * the UI shows the source and lets the user edit the price before generating,
 * and the API requires a price no matter what. Confirm against Zenoti before
 * a hook goes out.
 */

import type { HookOffer } from './hooks';

export interface ChinUpOffer extends HookOffer {
    id: string;
    name: string;
    /** What the patient gets, in plain words, for the prompt. */
    details: string;
    /** Wiki page the price came from. */
    source: string;
    /** Last day the offer runs, if the source gives one (YYYY-MM-DD). */
    validThrough?: string;
}

const NOV_BOARD = 'SamOS wiki: Chin Up Aesthetics/areas/marketing/ChinUp-November-2026-BoardFormat.md';

export const CHINUP_OFFERS: ChinUpOffer[] = [
    {
        id: 'botox-199-intro',
        name: '$199 Botox intro offer',
        treatment: 'Botox',
        aliases: ['tox'],
        price: 199,
        details: 'Intro Botox/Dysport price for new patients; Chin Up\'s main paid lead offer (Smyrna/Vinings and Decatur).',
        source: 'SamOS wiki: Chin Up Aesthetics/areas/marketing/199 Botox Campaign.md (updated 2026-07-12; confirm it is still running)',
    },
    {
        id: 'nov-holiday-tox-bank',
        name: 'Holiday Tox Bank (Beauty Bank)',
        treatment: 'Dysport',
        aliases: ['tox'],
        price: 650,
        details: '50 units Dysport plus 10 free units (60 units, about 2 areas) and a free B12 shot for Beauty Bank members. Regular $780.',
        source: NOV_BOARD,
        validThrough: '2026-11-30',
    },
    {
        id: 'nov-black-friday-tox-125',
        name: 'Black Friday Tox Bank: 125 units',
        treatment: 'Dysport',
        aliases: ['tox'],
        price: 1300,
        details: '100 units Dysport plus 25 free (125 units), used over the next 12 months. Regular $1,625. Nov 27-30 only.',
        source: NOV_BOARD,
        validThrough: '2026-11-30',
    },
    {
        id: 'nov-tired-look-fix',
        name: 'The Tired Look Fix',
        treatment: 'Restylane',
        aliases: ['filler'],
        price: 2113.2,
        details: '2 syringes Restylane (Lyft or Defyne) plus 50 units Dysport and a free Hydrinity kit. Beauty Bank price; regular $2,348. Buy Nov 27-30, use through Jan 31.',
        source: NOV_BOARD,
        validThrough: '2026-11-30',
    },
    {
        id: 'nov-texture-reset',
        name: 'Rough Texture and Acne Scar Reset',
        treatment: 'Microneedling',
        aliases: ['SkinPen'],
        price: 1274.4,
        details: '2 SkinPen microneedling sessions with PDGF growth factor at each. Beauty Bank price; regular $1,416.',
        source: NOV_BOARD,
        validThrough: '2026-11-30',
    },
];

export function findOffer(id: string | undefined | null): ChinUpOffer | undefined {
    return id ? CHINUP_OFFERS.find(o => o.id === id) : undefined;
}

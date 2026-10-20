import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CustomTooltip } from './AdsHelpers';

describe('CustomTooltip', () => {
    const payload = [
        { name: 'Meta Spend', value: 1234.4, color: '#fff' },
        { name: 'Google Spend', value: 50, color: '#fff' },
        { name: 'Leads', value: 7, color: '#fff' },
    ];
    const render = (isAdmin: boolean) =>
        renderToStaticMarkup(createElement(CustomTooltip, { active: true, payload, label: 'Oct 1', isAdmin }));

    it('formats every spend series as dollars', () => {
        const html = render(true);
        expect(html).toContain('Meta Spend: $1234');
        expect(html).toContain('Google Spend: $50');
        expect(html).toContain('Leads: 7');
    });

    it('hides spend from non-admins', () => {
        expect(render(false)).not.toContain('$');
    });
});

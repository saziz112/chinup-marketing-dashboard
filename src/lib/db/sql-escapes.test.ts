import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// In a JS/TS string or template literal '\D' cooks to 'D', so
// regexp_replace(phone, '\D', ...) strips the letter D instead of non-digits and
// formatted phones like (404) 555-1234 never match 4045551234. Write '\\D'.
function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return sourceFiles(p);
        return /\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
    });
}

describe('SQL regex escapes', () => {
    it('never uses a single-backslash \\D inside a JS string', () => {
        const offenders = [...sourceFiles('src'), ...sourceFiles('scripts')].flatMap(file =>
            readFileSync(file, 'utf8').split('\n')
                .map((line, i) => ({ line, i }))
                .filter(({ line }) => /regexp_replace\(.*'\\D'/.test(line))
                .map(({ i }) => `${file}:${i + 1}`),
        );
        expect(offenders).toEqual([]);
    });
});

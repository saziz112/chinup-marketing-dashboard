import postgres, { type Sql } from 'postgres';

declare global {
    // eslint-disable-next-line no-var
    var _pgClient: Sql | undefined;
}

function getClient(): Sql {
    if (globalThis._pgClient) return globalThis._pgClient;
    // POSTGRES_URL is auto-injected on Vercel via the Supabase Marketplace integration;
    // locally we fall back to the SBNEW_* values that vercel env pull provides.
    const connectionString =
        process.env.POSTGRES_URL ||
        process.env.SBNEW_POSTGRES_URL ||
        process.env.SBNEW_POSTGRES_PRISMA_URL ||
        process.env.SBNEW_POSTGRES_URL_NON_POOLING;
    if (!connectionString) {
        throw new Error('POSTGRES_URL (or SBNEW_POSTGRES_URL) is not set');
    }
    globalThis._pgClient = postgres(connectionString, {
        max: 5,
        idle_timeout: 20,
        connect_timeout: 10,
        prepare: false,
    });
    return globalThis._pgClient;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export type SqlResult<T = Row> = {
    rows: T[];
    rowCount: number;
    command: string;
};

interface SqlFn {
    <T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<SqlResult<T>>;
    query<T = Row>(text: string, values?: unknown[]): Promise<SqlResult<T>>;
}

function wrap<T>(p: Promise<unknown>): Promise<SqlResult<T>> {
    return p.then((raw) => {
        const r = raw as { count?: number; command?: string } & ArrayLike<unknown>;
        return {
            rows: Array.from(r) as T[],
            rowCount: r.count ?? 0,
            command: r.command ?? '',
        };
    });
}

const sqlImpl = (<T = Row>(
    strings: TemplateStringsArray,
    ...values: unknown[]
): Promise<SqlResult<T>> => {
    const client = getClient();
    // postgres.js accepts a TemplateStringsArray + tagged-template values
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return wrap<T>((client as any)(strings, ...values));
}) as SqlFn;

sqlImpl.query = function <T = Row>(text: string, values: unknown[] = []): Promise<SqlResult<T>> {
    const client = getClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return wrap<T>(client.unsafe(text, values as any));
};

export const sql = sqlImpl;

import pg from 'pg';

/**
 * TLS only for a database reached over the internet (a dotted host name, e.g. Render's
 * External URL). Render's Internal URL host has no dots and local dev is localhost.
 */
export function needsTls(url: string): boolean {
	if (/sslmode=disable/.test(url)) return false;
	if (/sslmode=require/.test(url)) return true;
	const host = new URL(url).hostname;
	return host.includes('.') && host !== '127.0.0.1';
}

// Created on first use: the build imports this file without a DATABASE_URL.
let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
	if (pool) return pool;
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) throw new Error('DATABASE_URL is not set');
	const ssl = needsTls(connectionString) ? { rejectUnauthorized: false } : false;
	pool = new pg.Pool({
		connectionString,
		ssl,
		max: Number(process.env.PG_POOL_MAX ?? 20),
		idleTimeoutMillis: 30_000,
		// a stuck query must not hold a connection forever
		statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 30_000)
	});
	return pool;
}

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
	return (await getPool().query<T>(text, params)).rows;
}

/** Run fn inside one transaction; rolls back if it throws. */
export async function tx<R>(fn: (q: typeof query) => Promise<R>): Promise<R> {
	const client = await getPool().connect();
	const q = async <T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) =>
		(await client.query<T>(text, params)).rows;
	try {
		await client.query('BEGIN');
		const out = await fn(q);
		await client.query('COMMIT');
		return out;
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

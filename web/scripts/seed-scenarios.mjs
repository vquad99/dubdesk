// Resets the sample video and loads the workflow test scenarios (db/seeds/scenarios.sql).
// Usage (Render -> dubdesk -> Shell):  cd web && npm run seed:scenarios
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set.');
	process.exit(1);
}
const host = new URL(url).hostname;
const tls = !/sslmode=disable/.test(url) && (/sslmode=require/.test(url) || (host.includes('.') && host !== '127.0.0.1'));
const client = new pg.Client({ connectionString: url, ssl: tls ? { rejectUnauthorized: false } : false });
const sql = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'seeds', 'scenarios.sql'), 'utf8');
await client.connect();
try {
	const out = await client.query(sql);
	const last = Array.isArray(out) ? out.at(-1) : out;
	console.table(last.rows);
	console.log('Scenarios loaded.');
} catch (e) {
	console.error('Failed:', e.message);
	process.exitCode = 1;
} finally {
	await client.end();
}

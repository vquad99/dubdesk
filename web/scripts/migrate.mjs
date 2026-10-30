// Apply db/migrations/*.sql in name order; each file runs once.
// Usage: DATABASE_URL=... node scripts/migrate.mjs
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
	await client.query(
		'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())'
	);
	const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
	const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

	for (const file of files) {
		if (done.has(file)) continue;
		const sql = await readFile(join(dir, file), 'utf8');
		await client.query('BEGIN');
		try {
			await client.query(sql);
			await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
			await client.query('COMMIT');
			console.log(`applied ${file}`);
		} catch (err) {
			await client.query('ROLLBACK');
			throw new Error(`${file}: ${err.message}`);
		}
	}
	console.log('migrations up to date');
} finally {
	await client.end();
}

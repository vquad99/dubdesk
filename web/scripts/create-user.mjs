// Create (or reset the password of) a user from the command line.
// Usage: DATABASE_URL=... node scripts/create-user.mjs <email> <name> <admin|reviewer|operator> <password>
import { randomBytes, scryptSync } from 'node:crypto';
import pg from 'pg';

const [email, name, role, password] = process.argv.slice(2);
if (!email || !name || !['admin', 'reviewer', 'operator'].includes(role) || !password || password.length < 8) {
	console.error('usage: create-user.mjs <email> <name> <admin|reviewer|operator> <password (8+ chars)>');
	process.exit(1);
}

// Same format as src/lib/server/password.ts
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
const stored = `scrypt$16384$${salt.toString('base64')}$${hash.toString('base64')}`;

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set. On Render, add it under Environment (use the Internal Database URL).');
	process.exit(1);
}
// Same rule as src/lib/server/db.ts: TLS only for a dotted (internet) host.
const host = new URL(url).hostname;
const tls = !/sslmode=disable/.test(url) && (/sslmode=require/.test(url) || (host.includes('.') && host !== '127.0.0.1'));
const client = new pg.Client({ connectionString: url, ssl: tls ? { rejectUnauthorized: false } : false });
await client.connect();
try {
	const { rows } = await client.query(
		`INSERT INTO users (email, name, role, password_hash)
		 VALUES (lower($1), $2, $3, $4)
		 ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role,
		     password_hash = EXCLUDED.password_hash, active = TRUE
		 RETURNING id`,
		[email, name, role, stored]
	);
	console.log(`user ${email} ready (id ${rows[0].id}, role ${role})`);
} finally {
	await client.end();
}

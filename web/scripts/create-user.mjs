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

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
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

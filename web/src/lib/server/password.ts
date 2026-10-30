import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Stored as scrypt$N$salt$hash (base64). scripts/create-user.mjs writes the same format.
const N = 16384;

export function hashPassword(password: string): string {
	const salt = randomBytes(16);
	const hash = scryptSync(password, salt, 64, { N, r: 8, p: 1 });
	return `scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	const [algo, n, saltB64, hashB64] = stored.split('$');
	if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
	const expected = Buffer.from(hashB64, 'base64');
	const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
		N: Number(n),
		r: 8,
		p: 1
	});
	return timingSafeEqual(actual, expected);
}

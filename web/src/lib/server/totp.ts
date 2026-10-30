import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Time-based one-time codes (RFC 6238), the 6-digit codes of Google Authenticator,
// Microsoft Authenticator, 1Password and the like. Secrets are stored encrypted.

const STEP = 30;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf: Buffer): string {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of buf) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += B32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += B32[(value << (5 - bits)) & 31];
	return out;
}

function unbase32(s: string): Buffer {
	const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
	let bits = 0;
	let value = 0;
	const out: number[] = [];
	for (const c of clean) {
		value = (value << 5) | B32.indexOf(c);
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}
	return Buffer.from(out);
}

export const newSecret = () => base32(randomBytes(20));

export function codeAt(secret: string, step: number): string {
	const msg = Buffer.alloc(8);
	msg.writeBigUInt64BE(BigInt(step));
	const h = createHmac('sha1', unbase32(secret)).update(msg).digest();
	const o = h[h.length - 1] & 15;
	const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
	return String(n % 1_000_000).padStart(6, '0');
}

/**
 * Check a code against the current 30-second window and one either side (clock drift).
 * Returns the matching step so the caller can refuse a replay of the same code.
 */
export function verifyCode(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
	const c = code.replace(/\s/g, '');
	if (!/^\d{6}$/.test(c)) return null;
	const cur = Math.floor(now / 1000 / STEP);
	for (const s of [cur, cur - 1, cur + 1]) {
		if (lastStep !== null && s <= lastStep) continue;
		if (timingSafeEqual(Buffer.from(codeAt(secret, s)), Buffer.from(c))) return s;
	}
	return null;
}

export function otpauthUri(secret: string, email: string, issuer = 'DubDesk'): string {
	return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
}

// ---------- encryption at rest (AES-256-GCM, key from APP_SECRET) ----------

function key(): Buffer | null {
	const s = process.env.APP_SECRET;
	return s && s.length >= 32 ? createHash('sha256').update(s).digest() : null;
}

export const canEncrypt = () => key() !== null;

export function seal(plain: string): string {
	const k = key();
	if (!k) throw new Error('APP_SECRET (32+ characters) must be set to use 2-step login.');
	const iv = randomBytes(12);
	const c = createCipheriv('aes-256-gcm', k, iv);
	const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
	return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${body.toString('base64')}`;
}

export function open(sealed: string): string {
	const k = key();
	if (!k) throw new Error('APP_SECRET is not set.');
	const [v, iv, tag, body] = sealed.split('.');
	if (v !== 'v1') throw new Error('unknown secret format');
	const d = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
	d.setAuthTag(Buffer.from(tag, 'base64'));
	return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
}

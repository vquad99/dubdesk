import { createHash, randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { query } from './db.ts';

export const SESSION_COOKIE = 'dqc_session';
const SESSION_DAYS = 14;

export type Role = 'admin' | 'reviewer' | 'operator';
export type SessionUser = { id: number; email: string; name: string; role: Role };

const tokenId = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(cookies: Cookies, userId: number, secure: boolean) {
	const token = randomBytes(32).toString('base64url');
	const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
	await query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [
		tokenId(token),
		userId,
		expires
	]);
	await query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
	await query('DELETE FROM sessions WHERE expires_at < now()');
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		expires
	});
}

export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
	if (!token) return null;
	const rows = await query<SessionUser>(
		`SELECT u.id, u.email, u.name, u.role
		   FROM sessions s JOIN users u ON u.id = s.user_id
		  WHERE s.id = $1 AND s.expires_at > now() AND u.active`,
		[tokenId(token)]
	);
	return rows[0] ?? null;
}

export async function deleteSession(cookies: Cookies) {
	const token = cookies.get(SESSION_COOKIE);
	if (token) await query('DELETE FROM sessions WHERE id = $1', [tokenId(token)]);
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** Where each role lands after login. */
export function homeFor(role: Role): string {
	return role === 'admin' ? '/admin' : role === 'reviewer' ? '/review' : '/operator';
}

import { createHash, randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { query } from './db.ts';

export const SESSION_COOKIE = 'dqc_session';
const SESSION_DAYS = 14; // hard limit, then log in again
const IDLE_HOURS = Number(process.env.SESSION_IDLE_HOURS ?? 12); // unused this long = logged out
const PENDING_MINUTES = 10; // time allowed to type the 2-step code

export type Role = 'admin' | 'reviewer' | 'operator';
export type SessionUser = { id: number; email: string; name: string; role: Role };
export type SessionState = { user: SessionUser; pending2fa: boolean; sessionId: string };

const tokenId = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(
	cookies: Cookies,
	userId: number,
	secure: boolean,
	meta: { ip?: string | null; userAgent?: string | null; pending2fa?: boolean } = {}
) {
	const token = randomBytes(32).toString('base64url');
	const pending = !!meta.pending2fa;
	const expires = new Date(Date.now() + (pending ? PENDING_MINUTES * 60_000 : SESSION_DAYS * 86400_000));
	await query(
		'INSERT INTO sessions (id, user_id, expires_at, ip, user_agent, pending_2fa) VALUES ($1, $2, $3, $4, $5, $6)',
		[tokenId(token), userId, expires, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null, pending]
	);
	if (!pending) await query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
	await query(`DELETE FROM sessions WHERE expires_at < now() OR last_seen_at < now() - make_interval(hours => $1)`, [IDLE_HOURS]);
	cookies.set(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, expires });
}

/** The session behind this cookie, if it is still valid. Touches last_seen at most once a minute. */
export async function getSession(token: string | undefined): Promise<SessionState | null> {
	if (!token) return null;
	const id = tokenId(token);
	const rows = await query<SessionUser & { pending_2fa: boolean; stale: boolean }>(
		`SELECT u.id, u.email, u.name, u.role, s.pending_2fa, s.last_seen_at < now() - interval '1 minute' AS stale
		   FROM sessions s JOIN users u ON u.id = s.user_id
		  WHERE s.id = $1 AND s.expires_at > now() AND u.active
		    AND s.last_seen_at > now() - make_interval(hours => $2)`,
		[id, IDLE_HOURS]
	);
	const r = rows[0];
	if (!r) return null;
	if (r.stale) await query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [id]);
	return { user: { id: r.id, email: r.email, name: r.name, role: r.role }, pending2fa: r.pending_2fa, sessionId: id };
}

/** Kept for callers that only need the signed-in person. */
export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
	const s = await getSession(token);
	return s && !s.pending2fa ? s.user : null;
}

export async function deleteSession(cookies: Cookies) {
	const token = cookies.get(SESSION_COOKIE);
	if (token) await query('DELETE FROM sessions WHERE id = $1', [tokenId(token)]);
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

export async function listSessions(userId: number) {
	return query<{ id: string; ip: string | null; user_agent: string | null; created_at: Date; last_seen_at: Date }>(
		`SELECT id, ip, user_agent, created_at, last_seen_at FROM sessions
		  WHERE user_id = $1 AND NOT pending_2fa AND expires_at > now() ORDER BY last_seen_at DESC`,
		[userId]
	);
}

/** Log out everywhere except the session given (or everywhere when none is given). */
export async function endOtherSessions(userId: number, keepId: string | null) {
	await query('DELETE FROM sessions WHERE user_id = $1 AND ($2::text IS NULL OR id <> $2)', [userId, keepId]);
}

/** Where each role lands after login. */
export function homeFor(role: Role): string {
	return role === 'admin' ? '/admin' : role === 'reviewer' ? '/review' : '/operator';
}

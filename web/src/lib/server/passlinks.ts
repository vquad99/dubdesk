import { createHash, randomBytes } from 'node:crypto';
import { query, tx } from './db.ts';
import { hashPassword } from './password.ts';

/** How long a link works: a new user gets a week to set up, a reset link an hour. */
const HOURS = { invite: 24 * 7, reset: 1 } as const;
export type LinkKind = keyof typeof HOURS;

export const MIN_PASSWORD = 10;

const idOf = (token: string) => createHash('sha256').update(token).digest('hex');

/** A one-time link to set a password. Earlier unused links for the same person stop working. */
/** The site address for links sent out. APP_ORIGIN (e.g. https://dubdesk.onrender.com) wins over the request's Host. */
export function siteOrigin(requestOrigin: string): string {
	const o = process.env.APP_ORIGIN?.trim();
	return o && /^https?:\/\/[^/]+$/.test(o) ? o : requestOrigin;
}

export async function createLink(userId: number, kind: LinkKind, createdBy: number | null, origin: string, hours: number = HOURS[kind]) {
	const token = randomBytes(32).toString('base64url');
	await tx(async (q) => {
		await q('UPDATE password_links SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
		await q(
			`INSERT INTO password_links (id, user_id, kind, created_by, expires_at)
			 VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))`,
			[idOf(token), userId, kind, createdBy, hours]
		);
	});
	return { url: `${siteOrigin(origin)}/login/reset/${token}`, hours };
}

export type LinkInfo = { userId: number; email: string; name: string; kind: LinkKind };

/** The person a link belongs to, if it is still usable. */
export async function checkLink(token: string): Promise<LinkInfo | null> {
	if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null;
	const [row] = await query<{ user_id: number; email: string; name: string; kind: LinkKind }>(
		`SELECT l.user_id, u.email, u.name, l.kind FROM password_links l JOIN users u ON u.id = l.user_id
		  WHERE l.id = $1 AND l.used_at IS NULL AND l.expires_at > now() AND u.active`,
		[idOf(token)]
	);
	return row ? { userId: row.user_id, email: row.email, name: row.name, kind: row.kind } : null;
}

/** Use the link once: set the password, end every session, close open requests. */
export async function useLink(token: string, password: string): Promise<LinkInfo | null> {
	return tx(async (q) => {
		const rows = await q<{ user_id: number; kind: LinkKind }>(
			`UPDATE password_links SET used_at = now()
			  WHERE id = $1 AND used_at IS NULL AND expires_at > now()
			    AND user_id IN (SELECT id FROM users WHERE active)
			  RETURNING user_id, kind`,
			[idOf(token)]
		);
		if (!rows.length) return null;
		const { user_id, kind } = rows[0];
		const [u] = await q<{ email: string; name: string }>(
			'UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1 RETURNING email, name',
			[user_id, hashPassword(password)]
		);
		await q('DELETE FROM sessions WHERE user_id = $1', [user_id]);
		await q('UPDATE password_requests SET handled_at = now() WHERE user_id = $1 AND handled_at IS NULL', [user_id]);
		return { userId: user_id, email: u.email, name: u.name, kind };
	});
}

/** A password nobody knows, for accounts that must set their own through a link. */
export function unusablePassword(): string {
	return hashPassword(randomBytes(32).toString('base64url'));
}

// ---------------- optional e-mail ----------------

/** E-mail goes out only when RESEND_API_KEY and MAIL_FROM are set; otherwise the admin shares the link. */
export const mailEnabled = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

const lasts = (hours: number) => (hours >= 48 ? `${Math.round(hours / 24)} days` : hours === 1 ? '1 hour' : `${hours} hours`);

export async function sendLinkMail(to: string, name: string, kind: LinkKind, url: string, hours: number): Promise<boolean> {
	if (!mailEnabled()) return false;
	const subject = kind === 'invite' ? 'Your DubDesk account' : 'Reset your DubDesk password';
	const lead =
		kind === 'invite'
			? `An account has been made for you on DubDesk. Set your password with this link (it works for ${lasts(hours)}):`
			: `Use this link to set a new DubDesk password. It works once, for ${lasts(hours)}:`;
	const text = `Hi ${name},\n\n${lead}\n\n${url}\n\nIf you did not expect this, ignore this e-mail.`;
	try {
		const r = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
			body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
			signal: AbortSignal.timeout(10_000)
		});
		if (!r.ok) console.error(`[mail] ${r.status} ${(await r.text()).slice(0, 200)}`);
		return r.ok;
	} catch (e) {
		console.error('[mail] failed', e);
		return false;
	}
}

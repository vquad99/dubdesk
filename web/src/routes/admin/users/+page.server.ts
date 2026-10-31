import { fail } from '@sveltejs/kit';
import { query } from '#lib/server/db.ts';
import { hashPassword } from '#lib/server/password.ts';
import { track } from '#lib/server/activity.ts';
import { createLink, mailEnabled, sendLinkMail, unusablePassword } from '#lib/server/passlinks.ts';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

const ROLES = ['admin', 'reviewer', 'operator'];
const ADMIN_LINK_HOURS = 24; // a reset link the admin passes on by chat gets a day
const MAX_BULK = 300;

export const load: PageServerLoad = async () => {
	const [users, requests] = await Promise.all([
		query<{
			id: number;
			email: string;
			name: string;
			role: string;
			active: boolean;
			last_login_at: Date | null;
			totp_enabled: boolean;
			invited: boolean;
		}>(
			`SELECT u.id, u.email, u.name, u.role, u.active, u.last_login_at, u.totp_enabled,
			        (u.last_login_at IS NULL AND EXISTS (SELECT 1 FROM password_links l WHERE l.user_id = u.id AND l.kind = 'invite')) AS invited
			   FROM users u ORDER BY u.active DESC, u.role, u.name`
		),
		query<{ id: number; user_id: number; name: string; email: string; created_at: Date }>(
			`SELECT r.id, r.user_id, u.name, u.email, r.created_at FROM password_requests r JOIN users u ON u.id = r.user_id
			  WHERE r.handled_at IS NULL AND u.active ORDER BY r.created_at`
		)
	]);
	return { users, requests, mail: mailEnabled() };
};

type Created = { name: string; email: string; role: string; link: string; mailed: boolean };

/** Make one account that has no password yet; the person sets it through the invite link. */
async function invite(event: RequestEvent, name: string, email: string, role: string): Promise<Created | null> {
	const rows = await query<{ id: number }>(
		`INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)
		 ON CONFLICT (email) DO NOTHING RETURNING id`,
		[email, name, role, unusablePassword()]
	);
	if (!rows.length) return null;
	const link = await createLink(rows[0].id, 'invite', event.locals.user!.id, event.url.origin);
	const mailed = await sendLinkMail(email, name, 'invite', link.url, link.hours);
	return { name, email, role, link: link.url, mailed };
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export const actions: Actions = {
	add: async (event) => {
		const f = await event.request.formData();
		const email = String(f.get('email') ?? '').trim().toLowerCase();
		const name = String(f.get('name') ?? '').trim().slice(0, 120);
		const role = String(f.get('role') ?? '');
		const password = String(f.get('password') ?? '');

		if (!EMAIL_RE.test(email) || !name || !ROLES.includes(role)) return fail(400, { error: 'Fill in name, email and role.' });

		if (!password) {
			// No password typed: send an invite link and let them choose their own.
			const made = await invite(event, name, email, role);
			if (!made) return fail(400, { error: `${email} already exists.` });
			await track(event, 'user.created', { details: `${name} <${email}> as ${role} (invite link)` });
			return { message: `Added ${name}.`, created: [made] };
		}
		if (password.length < 8) return fail(400, { error: 'Password must be at least 8 characters.' });
		const rows = await query(
			`INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)
			 ON CONFLICT (email) DO NOTHING RETURNING id`,
			[email, name, role, hashPassword(password)]
		);
		if (rows.length === 0) return fail(400, { error: `${email} already exists.` });
		await track(event, 'user.created', { details: `${name} <${email}> as ${role}` });
		return { message: `Added ${name}.` };
	},

	/** Paste or upload many people at once: one per line, "name, email, role". */
	bulk: async (event) => {
		const f = await event.request.formData();
		const fallbackRole = ROLES.includes(String(f.get('role'))) ? String(f.get('role')) : 'reviewer';
		const lines = String(f.get('list') ?? '')
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean);
		if (!lines.length) return fail(400, { error: 'Paste at least one line: name, email, role.' });
		if (lines.length > MAX_BULK + 1) return fail(400, { error: `At most ${MAX_BULK} people at a time.` });

		const created: Created[] = [];
		const skipped: { line: string; why: string }[] = [];
		const seen = new Set<string>();
		for (const [i, line] of lines.entries()) {
			const parts = line.split(/[,;\t]/).map((p) => p.trim().replace(/^"|"$/g, ''));
			const at = parts.findIndex((p) => p.includes('@'));
			if (at === -1) {
				// A first-line header such as "name,email,role" is skipped quietly.
				if (!(i === 0 && /e-?mail/i.test(line))) skipped.push({ line, why: 'no e-mail on this line' });
				continue;
			}
			const email = parts[at].toLowerCase();
			const rest = parts.filter((_, i) => i !== at);
			const roleWord = rest.find((p) => ROLES.includes(p.toLowerCase()));
			const role = roleWord ? roleWord.toLowerCase() : fallbackRole;
			const name = (rest.find((p) => p && p !== roleWord) ?? email.split('@')[0]).slice(0, 120);
			if (!EMAIL_RE.test(email)) {
				skipped.push({ line, why: 'e-mail does not look right' });
				continue;
			}
			if (seen.has(email)) {
				skipped.push({ line, why: 'listed twice' });
				continue;
			}
			seen.add(email);
			const made = await invite(event, name, email, role);
			if (made) created.push(made);
			else skipped.push({ line, why: 'already has an account' });
		}
		if (created.length) await track(event, 'user.bulk_created', { details: `${created.length} added, ${skipped.length} skipped` });
		return { message: `Added ${created.length}${skipped.length ? `, skipped ${skipped.length}` : ''}.`, created, skipped };
	},

	/** A one-time link the person opens to set a new password (forgot password, or admin reset). */
	resetLink: async (event) => {
		const id = Number((await event.request.formData()).get('id'));
		const [u] = await query<{ id: number; name: string; email: string; last_login_at: Date | null }>(
			'SELECT id, name, email, last_login_at FROM users WHERE id = $1 AND active',
			[id]
		);
		if (!u) return fail(404, { error: 'That user is turned off or does not exist.' });
		const kind = u.last_login_at ? 'reset' : 'invite';
		const link = await createLink(u.id, kind, event.locals.user!.id, event.url.origin, kind === 'reset' ? ADMIN_LINK_HOURS : undefined);
		const mailed = await sendLinkMail(u.email, u.name, kind, link.url, link.hours);
		await query('UPDATE password_requests SET handled_at = now(), handled_by = $2 WHERE user_id = $1 AND handled_at IS NULL', [u.id, event.locals.user!.id]);
		await track(event, 'user.reset_link', { details: `${u.name} <${u.email}>${mailed ? ' (e-mailed)' : ''}` });
		return { message: mailed ? `Link e-mailed to ${u.email}.` : 'Link ready. Send it to them.', link: { name: u.name, email: u.email, url: link.url, hours: link.hours, mailed } };
	},

	dismissRequest: async (event) => {
		const id = Number((await event.request.formData()).get('id'));
		await query('UPDATE password_requests SET handled_at = now(), handled_by = $2 WHERE id = $1', [id, event.locals.user!.id]);
		return { message: 'Request dismissed.' };
	},

	update: async (event) => {
		const { request, locals } = event;
		const f = await request.formData();
		const id = Number(f.get('id'));
		const role = String(f.get('role') ?? '');
		const active = f.get('active') === 'on';
		if (!ROLES.includes(role)) return fail(400, { error: 'Unknown role.' });
		if (id === locals.user!.id && (role !== 'admin' || !active)) {
			return fail(400, { error: 'You cannot remove your own admin access.' });
		}
		await query('UPDATE users SET role = $2, active = $3 WHERE id = $1', [id, role, active]);
		if (!active) await query('DELETE FROM sessions WHERE user_id = $1', [id]);
		await track(event, 'user.updated', { details: `user ${id}: role ${role}, ${active ? 'active' : 'turned off'}` });
		return { message: 'Saved.' };
	},

	reset2fa: async (event) => {
		const id = Number((await event.request.formData()).get('id'));
		await query('UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, totp_last_step = NULL WHERE id = $1', [id]);
		await query('DELETE FROM sessions WHERE user_id = $1', [id]);
		await track(event, 'user.2fa_reset', { details: `user ${id}` });
		return { message: 'Two-step login reset. They can set it up again from their profile.' };
	},

	password: async (event) => {
		const { request } = event;
		const f = await request.formData();
		const id = Number(f.get('id'));
		const password = String(f.get('password') ?? '');
		if (password.length < 8) return fail(400, { error: 'Password must be at least 8 characters.' });
		await query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, hashPassword(password)]);
		await query('DELETE FROM sessions WHERE user_id = $1', [id]);
		await track(event, 'user.password_set', { details: `user ${id}` });
		return { message: 'Password changed. That user must log in again.' };
	}
};

import { fail } from '@sveltejs/kit';
import { query } from '#lib/server/db.ts';
import { hashPassword } from '#lib/server/password.ts';
import { track } from '#lib/server/activity.ts';
import type { Actions, PageServerLoad } from './$types';

const ROLES = ['admin', 'reviewer', 'operator'];

export const load: PageServerLoad = async () => ({
	users: await query<{
		id: number;
		email: string;
		name: string;
		role: string;
		active: boolean;
		last_login_at: Date | null;
		totp_enabled: boolean;
	}>('SELECT id, email, name, role, active, last_login_at, totp_enabled FROM users ORDER BY active DESC, role, name')
});

export const actions: Actions = {
	add: async (event) => {
		const { request } = event;
		const f = await request.formData();
		const email = String(f.get('email') ?? '').trim().toLowerCase();
		const name = String(f.get('name') ?? '').trim();
		const role = String(f.get('role') ?? '');
		const password = String(f.get('password') ?? '');

		if (!email.includes('@') || !name || !ROLES.includes(role)) {
			return fail(400, { error: 'Fill in name, email and role.' });
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

import { error, fail } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { query } from '#lib/server/db.ts';
import { listActivity, track } from '#lib/server/activity.ts';
import { loadProfile } from '#lib/server/profile.ts';
import { hashPassword, verifyPassword } from '#lib/server/password.ts';
import { endOtherSessions, listSessions } from '#lib/server/session.ts';
import { canEncrypt, newSecret, open, otpauthUri, seal, verifyCode } from '#lib/server/totp.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const me = locals.user!.id;
	const [p, act, sessions, [sec]] = await Promise.all([
		loadProfile(me),
		listActivity({ userId: me, limit: 40 }),
		listSessions(me),
		query<{ totp_enabled: boolean; password_changed_at: Date | null }>(
			'SELECT totp_enabled, password_changed_at FROM users WHERE id = $1',
			[me]
		)
	]);
	if (!p) error(404, 'Profile not found');
	return {
		p,
		activity: act.rows,
		security: {
			totp: sec.totp_enabled,
			canTotp: canEncrypt(),
			passwordChanged: sec.password_changed_at,
			sessions: sessions.map((s) => ({ ...s, current: s.id === locals.sessionId, id: s.id.slice(0, 8) }))
		}
	};
};

const MIN_PASSWORD = 10;

export const actions: Actions = {
	start2fa: async ({ locals }) => {
		if (!canEncrypt()) return fail(400, { error: 'Two-step login is not set up on this server yet (APP_SECRET is missing).' });
		const secret = newSecret();
		await query('UPDATE users SET totp_secret = $2, totp_enabled = FALSE, totp_last_step = NULL WHERE id = $1', [
			locals.user!.id,
			seal(secret)
		]);
		const uri = otpauthUri(secret, locals.user!.email);
		const qr = await QRCode.toString(uri, { type: 'svg', margin: 1, width: 200, color: { dark: '#1f1f1f', light: '#ffffff' } });
		return { setup: { qr, secret: secret.replace(/(.{4})/g, '$1 ').trim() } };
	},

	confirm2fa: async (event) => {
		const me = event.locals.user!.id;
		const code = String((await event.request.formData()).get('code') ?? '');
		const [u] = await query<{ totp_secret: string | null }>('SELECT totp_secret FROM users WHERE id = $1', [me]);
		const step = u?.totp_secret ? verifyCode(open(u.totp_secret), code, null) : null;
		if (step === null) return fail(400, { error: 'That code did not match. Scan the QR code again and use the newest code.', setupFailed: true });
		await query('UPDATE users SET totp_enabled = TRUE, totp_last_step = $2 WHERE id = $1', [me, step]);
		await track(event, 'auth.2fa_enabled');
		return { message: 'Two-step login is on. You will be asked for a code each time you log in.' };
	},

	disable2fa: async (event) => {
		const me = event.locals.user!.id;
		const code = String((await event.request.formData()).get('code') ?? '');
		const [u] = await query<{ totp_secret: string | null; totp_last_step: string | null }>(
			'SELECT totp_secret, totp_last_step FROM users WHERE id = $1',
			[me]
		);
		const step = u?.totp_secret ? verifyCode(open(u.totp_secret), code, u.totp_last_step ? Number(u.totp_last_step) : null) : null;
		if (step === null) return fail(400, { error: 'That code is not right, so two-step login stays on.' });
		await query('UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, totp_last_step = NULL WHERE id = $1', [me]);
		await track(event, 'auth.2fa_disabled');
		return { message: 'Two-step login is off.' };
	},

	password: async (event) => {
		const me = event.locals.user!.id;
		const f = await event.request.formData();
		const current = String(f.get('current') ?? '');
		const next = String(f.get('next') ?? '');
		const again = String(f.get('again') ?? '');
		const [u] = await query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [me]);
		if (!verifyPassword(current, u.password_hash)) return fail(400, { error: 'Your current password is not right.' });
		if (next.length < MIN_PASSWORD) return fail(400, { error: `Use at least ${MIN_PASSWORD} characters.` });
		if (next !== again) return fail(400, { error: 'The two new passwords are not the same.' });
		if (next.toLowerCase().includes(event.locals.user!.email.split('@')[0].toLowerCase()))
			return fail(400, { error: 'Do not use your email name in your password.' });
		await query('UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1', [me, hashPassword(next)]);
		await endOtherSessions(me, event.locals.sessionId);
		await track(event, 'auth.password_changed', { details: 'other devices logged out' });
		return { message: 'Password changed. Your other devices were logged out.' };
	},

	endSessions: async (event) => {
		await endOtherSessions(event.locals.user!.id, event.locals.sessionId);
		await track(event, 'auth.sessions_ended');
		return { message: 'Logged out on all other devices.' };
	}
};

import { fail, redirect } from '@sveltejs/kit';
import { query } from '#lib/server/db.ts';
import { track } from '#lib/server/activity.ts';
import { recordLoginFailure, clearLoginFailures, loginBlockedFor } from '#lib/server/ratelimit.ts';
import { createSession, deleteSession, homeFor } from '#lib/server/session.ts';
import { open, verifyCode } from '#lib/server/totp.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, homeFor(locals.user.role));
	if (!locals.pending) redirect(303, '/login');
	return { email: locals.pending.email };
};

export const actions: Actions = {
	default: async (event) => {
		const { request, cookies, url, locals } = event;
		const who = locals.pending;
		if (!who) redirect(303, '/login');
		let ip = 'unknown';
		try {
			ip = event.getClientAddress();
		} catch {
			/* no address */
		}
		const key = `2fa:${who.email}`;
		if (await loginBlockedFor(key, ip)) {
			await deleteSession(cookies);
			await track(event, 'auth.login_blocked', { userId: who.id, details: 'too many wrong 2-step codes' });
			redirect(303, '/login?blocked=1');
		}

		const code = String((await request.formData()).get('code') ?? '');
		const [u] = await query<{ totp_secret: string | null; totp_last_step: string | null }>(
			'SELECT totp_secret, totp_last_step FROM users WHERE id = $1',
			[who.id]
		);
		const step = u?.totp_secret ? verifyCode(open(u.totp_secret), code, u.totp_last_step ? Number(u.totp_last_step) : null) : null;
		if (step === null) {
			await recordLoginFailure(key, ip);
			await track(event, 'auth.2fa_failed', { userId: who.id });
			return fail(400, { error: 'That code is not right. Use the newest code in your authenticator app.' });
		}

		await query('UPDATE users SET totp_last_step = $2 WHERE id = $1', [who.id, step]);
		await clearLoginFailures(key);
		// A fresh session id once fully signed in, so the half-signed-in one can never be reused.
		await deleteSession(cookies);
		await createSession(cookies, who.id, url.protocol === 'https:', { ip, userAgent: request.headers.get('user-agent') });
		await track(event, 'auth.login', { userId: who.id, details: 'with 2-step code' });
		const next = url.searchParams.get('next');
		redirect(303, next && next.startsWith('/') && !next.startsWith('//') ? next : homeFor(who.role));
	}
};
